#!/usr/bin/env python3
"""Verify Harlgram's packaged arm64 libraries and notices without inspecting credentials.

Requires Python 3 and host-compatible llvm-readelf / llvm-nm from the Native SDK.
This is a package-structure gate, not a signing, account, or device-runtime test.
"""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib


LIBRARIES = ('libentry.so', 'libtdjson.so', 'libc++_shared.so')
LICENSES = ('TDLib.txt', 'OpenSSL.txt', 'SQLCipher.txt', 'LLVM.txt',
            'Libphonenumber.txt', 'Unicode-CLDR.txt', 'Harlgram-GPL-3.0.txt',
            'Harlgram-Notices.txt')
TD_EXPORTS = frozenset(('td_create_client_id', 'td_send', 'td_receive', 'td_execute'))
MAX_LIBRARY_BYTES = 512 * 1024 * 1024
MAX_LICENSE_BYTES = 2 * 1024 * 1024


class VerificationError(Exception):
    """Only static, non-sensitive descriptions may be placed in this exception."""


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default diagnostic may echo arbitrary paths/argument values.
        raise VerificationError('Invalid arguments; use --help for usage.')


def tool_path(directory, name):
    candidate = directory / name
    if not candidate.is_file():
        candidate = directory / (name + '.exe')
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        raise VerificationError('Required SDK LLVM tool is missing or not executable: ' + name)
    # SDK tools may be multicall symlinks (llvm-readelf -> llvm-readobj).
    # Preserve argv[0], which selects readelf's GNU-compatible output format.
    return candidate.absolute()


def run_tool(tool, arguments):
    try:
        result = subprocess.run(
            [str(tool), *arguments], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=30, check=False, env={**os.environ, 'LC_ALL': 'C', 'LANG': 'C'})
    except (OSError, subprocess.TimeoutExpired):
        raise VerificationError('SDK LLVM inspection could not complete.') from None
    if result.returncode != 0 or result.stderr.strip():
        # LLVM may report damaged ELF structures as warnings with exit status 0.
        # Raw diagnostics can contain paths and bytes from the input; never echo them.
        raise VerificationError('SDK LLVM inspection rejected a native library.')
    return result.stdout.decode('utf-8', errors='replace')


def unique_suffix(members, suffix):
    matches = [item for item in members if item.filename == suffix or item.filename.endswith('/' + suffix)]
    if len(matches) != 1 or matches[0].is_dir():
        raise VerificationError('Missing or ambiguous required package member: ' + suffix)
    return matches[0]


def read_member(archive, member, limit, destination=None):
    if member.flag_bits & 1 or not 0 < member.file_size <= limit:
        raise VerificationError('A required package member is empty, encrypted, or oversized.')
    total = 0
    has_content = False
    try:
        with archive.open(member) as source:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise VerificationError('A required package member exceeds its size limit.')
                if destination is not None:
                    destination.write(chunk)
                else:
                    has_content = has_content or bool(chunk.strip())
    except (OSError, RuntimeError, NotImplementedError, zipfile.BadZipFile, EOFError, zlib.error):
        raise VerificationError('A required package member is corrupt or unreadable.') from None
    if total != member.file_size or (destination is None and not has_content):
        raise VerificationError('A required package member is empty or incomplete.')


def verify_elf(path, readelf):
    # A minimal header check avoids accepting a misleading textual tool response;
    # LLVM performs the detailed ELF inspection rather than a home-grown ELF parser.
    with path.open('rb') as source:
        header = source.read(64)
    if (len(header) != 64 or header[:7] != b'\x7fELF\x02\x01\x01'
            or struct.unpack_from('<HH', header, 16) != (3, 183)):
        raise VerificationError('A required library is not an ELF64 little-endian AArch64 shared object.')
    description = run_tool(readelf, ['--file-header', '--dynamic', str(path)])
    if (not re.search(r'^\s*Class:\s+ELF64\s*$', description, re.MULTILINE)
            or not re.search(r'^\s*Machine:\s+AArch64\s*$', description, re.MULTILINE)
            or not re.search(r'^\s*Type:\s+DYN\b', description, re.MULTILINE)):
        raise VerificationError('SDK LLVM did not confirm the required ELF architecture and type.')
    return description


def verify(hap, llvm_bin):
    readelf = tool_path(llvm_bin, 'llvm-readelf')
    nm = tool_path(llvm_bin, 'llvm-nm')
    if not hap.is_file() or hap.stat().st_size == 0:
        raise VerificationError('The specified HAP is missing or empty.')
    with hap.open('rb') as package, zipfile.ZipFile(package) as archive:
        members = archive.infolist()
        names = [item.filename for item in members]
        if not members or len(names) != len(set(names)):
            raise VerificationError('The HAP is empty or contains duplicate archive entries.')
        for name in names:
            parts = name.rstrip('/').split('/')
            if ('\\' in name or PurePosixPath(name).is_absolute()
                    or any(part in ('', '.', '..') for part in parts)):
                raise VerificationError('The HAP contains an unsafe or ambiguous archive path.')

        library_members = {}
        for library in LIBRARIES:
            member = unique_suffix(members, 'arm64-v8a/' + library)
            if member.filename != 'libs/arm64-v8a/' + library:
                raise VerificationError('A required library is outside the HAP native library directory.')
            library_members[library] = member
        for license_name in LICENSES:
            member = unique_suffix(members, 'rawfile/licenses/' + license_name)
            read_member(archive, member, MAX_LICENSE_BYTES)

        with tempfile.TemporaryDirectory(prefix='harlgram-hap-verify-') as temporary:
            temporary_path = Path(temporary)
            td_description = ''
            for library, member in library_members.items():
                output = temporary_path / library
                # Never use ZipFile.extract: only the three named native libraries
                # are written, under fixed filenames in a private temporary folder.
                with output.open('wb') as destination:
                    read_member(archive, member, MAX_LIBRARY_BYTES, destination)
                description = verify_elf(output, readelf)
                if library == 'libtdjson.so':
                    td_description = description
            sonames = re.findall(r'\(SONAME\)[^\r\n]*\[([^\]\r\n]+)\]', td_description)
            if sonames != ['libtdjson.so']:
                raise VerificationError('TDLib must have the unversioned SONAME libtdjson.so.')
            symbols = run_tool(nm, ['--dynamic', '--defined-only', '--extern-only', '--format=posix',
                                    str(temporary_path / 'libtdjson.so')])
            functions = set()
            for line in symbols.splitlines():
                fields = line.split()
                if len(fields) >= 2 and fields[1] in ('T', 'W'):
                    functions.add(fields[0])
            if not TD_EXPORTS.issubset(functions):
                raise VerificationError('TDLib is missing one or more required defined JSON C ABI function exports.')

        package.seek(0)
        digest = hashlib.sha256()
        while True:
            chunk = package.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = SafeArgumentParser(description=__doc__)
    parser.add_argument('--hap', type=Path, required=True, help='One explicitly selected HAP file')
    tools = parser.add_mutually_exclusive_group(required=True)
    tools.add_argument('--native-sdk', type=Path, help='Native SDK root containing llvm/bin')
    tools.add_argument('--llvm-bin', type=Path, help='Directory containing host llvm-readelf and llvm-nm')
    try:
        args = parser.parse_args()
        llvm_bin = args.llvm_bin if args.llvm_bin is not None else args.native_sdk / 'llvm' / 'bin'
        digest = verify(args.hap, llvm_bin)
    except VerificationError as error:
        print('HAP verification failed: ' + str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, EOFError, struct.error, zipfile.BadZipFile, zipfile.LargeZipFile):
        print('HAP verification failed: package or tool input is unreadable or corrupt.', file=sys.stderr)
        return 1
    print('HAP structure: PASS')
    print('Native libraries: 3 ELF64 AArch64 shared objects (arm64-v8a)')
    print('TDLib: unversioned SONAME and 4 defined JSON C ABI exports')
    print('Packaged license files: 8')
    print('SHA256: ' + digest)
    print('Scope: package structure only; signing, account access, and device runtime are not verified.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
