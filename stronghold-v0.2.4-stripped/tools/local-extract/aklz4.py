# LZ4AK decompressor for Arknights bundles (algorithm from isHarryh/Ark-Unpacker, BSD-3, via MooncellWiki/UnityPy)
# SPDX-License-Identifier: BSD-3-Clause
# Copyright (c) 2022, Harry Huang (isHarryh/Ark-Unpacker). Unlike the rest of this project (GPL-3.0-or-later), this
# file is distributed under the BSD 3-Clause License of Ark-Unpacker: tools/local-extract/LICENSE-Ark-Unpacker.txt
# (UnityPy, which it plugs into, is MIT; see THIRD-PARTY-NOTICES.md).
import lz4.block
from UnityPy.helpers import CompressionHelper
from UnityPy.enums.BundleFile import CompressionFlags

def _xlen(d, p, m):
    l = 0
    while p < m:
        b = d[p]; l += b; p += 1
        if b != 0xFF: break
    return l, p

def decompress_lz4ak(data, usize):
    ip = op = 0
    d = bytearray(data); n = len(d)
    while ip < n:
        lit = d[ip] & 0xF; mat = (d[ip] >> 4) & 0xF
        d[ip] = (lit << 4) | mat; ip += 1
        if lit == 0xF:
            l, ip = _xlen(d, ip, n); lit += l
        ip += lit; op += lit
        if op >= usize: break
        off = (d[ip] << 8) | d[ip + 1]
        d[ip] = off & 0xFF; d[ip + 1] = (off >> 8) & 0xFF; ip += 2
        if mat == 0xF:
            l, ip = _xlen(d, ip, n); mat += l
        op += mat + 4
    return lz4.block.decompress(bytes(d), usize)

CompressionHelper.DECOMPRESSION_MAP[CompressionFlags.LZHAM] = decompress_lz4ak
