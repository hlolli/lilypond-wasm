#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


WASM_PREAMBLE = b"\0asm\x01\0\0\0"
U32_MAX = (1 << 32) - 1


class WasmFormatError(ValueError):
    pass


def encode_u32_leb(value: int) -> bytes:
    if not 0 <= value <= U32_MAX:
        raise ValueError(f"value does not fit in u32: {value}")

    encoded = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            byte |= 0x80
        encoded.append(byte)
        if not value:
            return bytes(encoded)


def decode_u32_leb(data: bytes, offset: int) -> tuple[int, int]:
    value = 0

    for byte_index in range(5):
        if offset >= len(data):
            raise WasmFormatError("truncated u32 LEB128 value")

        byte = data[offset]
        offset += 1

        if byte_index == 4 and byte & 0xF0:
            raise WasmFormatError("u32 LEB128 value is too large")

        value |= (byte & 0x7F) << (byte_index * 7)
        if not byte & 0x80:
            return value, offset

    raise WasmFormatError("u32 LEB128 value is longer than five bytes")


def custom_section_names(module: bytes) -> list[str]:
    if not module.startswith(WASM_PREAMBLE):
        raise WasmFormatError("input does not have the WebAssembly 1 preamble")

    names = []
    offset = len(WASM_PREAMBLE)

    while offset < len(module):
        section_id = module[offset]
        offset += 1

        section_size, offset = decode_u32_leb(module, offset)
        section_end = offset + section_size
        if section_end > len(module):
            raise WasmFormatError("section extends past the end of the module")

        if section_id == 0:
            name_size, name_offset = decode_u32_leb(module, offset)
            name_end = name_offset + name_size
            if name_end > section_end:
                raise WasmFormatError("custom section name exceeds its section")

            try:
                names.append(module[name_offset:name_end].decode("utf-8"))
            except UnicodeDecodeError as error:
                raise WasmFormatError(
                    "custom section name is not valid UTF-8"
                ) from error

        offset = section_end

    return names


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Append a named JSON custom section to a WebAssembly module."
    )
    parser.add_argument("--name", required=True, help="custom section name")
    parser.add_argument("--payload", required=True, type=Path, help="JSON payload")
    parser.add_argument("input", type=Path, help="input WebAssembly module")
    parser.add_argument("output", type=Path, help="new WebAssembly module")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()

    if arguments.input.resolve() == arguments.output.resolve():
        raise SystemExit("input and output paths must differ")

    module = arguments.input.read_bytes()
    payload = arguments.payload.read_bytes()

    try:
        metadata = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"metadata payload is not valid UTF-8 JSON: {error}") from error

    if not isinstance(metadata, dict):
        raise SystemExit("metadata payload must be a JSON object")

    try:
        existing_names = custom_section_names(module)
    except WasmFormatError as error:
        raise SystemExit(f"invalid input module: {error}") from error

    if arguments.name in existing_names:
        raise SystemExit(f"custom section already exists: {arguments.name}")

    name = arguments.name.encode("utf-8")
    contents = encode_u32_leb(len(name)) + name + payload
    section = b"\0" + encode_u32_leb(len(contents)) + contents

    arguments.output.write_bytes(module + section)


if __name__ == "__main__":
    main()
