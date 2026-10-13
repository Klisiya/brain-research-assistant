"""Hub-only legacy Office validation; storage stays in FileAssetService."""
import hashlib
import struct
import olefile
from attachment_files import AttachmentError, FILE_LIMITS, safe_filename, too_large, validate_file


def validate_hub_file(upload, kind, limits=None):
    filename = safe_filename(upload.filename) if upload is not None else ''
    extension = filename.rsplit('.', 1)[-1].lower()
    legacy = {'slides': ('ppt', 'application/vnd.ms-powerpoint'), 'document': ('doc', 'application/msword')}
    if kind not in legacy or extension != legacy[kind][0]:
        return validate_file(upload, kind, limits)
    if upload.mimetype != legacy[kind][1]:
        raise AttachmentError('This file type is not allowed.', 'FILE_TYPE_NOT_ALLOWED')
    stream = upload.stream
    stream.seek(0)
    size, digest = 0, hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        size += len(chunk)
        if size > (limits or FILE_LIMITS)[kind]:
            raise too_large()
        digest.update(chunk)
    stream.seek(0)
    try:
        with olefile.OleFileIO(stream, raise_defects=olefile.DEFECT_INCORRECT) as container:
            paths = container.listdir(streams=True, storages=True)
            if len(paths) > 1024 or any(any(
                word in part.lower() for word in ('vba', 'macro', 'objectpool', 'ole10native', 'encrypted', 'encryption', 'embeddings')
            ) for path in paths for part in path):
                raise ValueError('Active or encrypted content is unsupported.')
            total = 0
            for path in container.listdir():
                length = container.get_size(path)
                total += length
                if total > 2 * FILE_LIMITS[kind] or length > FILE_LIMITS[kind]:
                    raise ValueError('Invalid container size.')
                if len(container.openstream(path).read()) != length:
                    raise ValueError('Truncated stream.')
            if kind == 'document':
                header = container.openstream('WordDocument').read(32)
                if len(header) < 32 or header[:2] != b'\xec\xa5':
                    raise ValueError('Invalid Word header.')
                flags = struct.unpack_from('<H', header, 10)[0]
                if flags & (0x0100 | 0x8000) or not container.exists('1Table' if flags & 0x0200 else '0Table'):
                    raise ValueError('Encrypted or incomplete Word document.')
            else:
                current = container.openstream('Current User').read(20)
                if len(current) < 20 or struct.unpack_from('<I', current, 12)[0] != 0xe391c05f:
                    raise ValueError('Encrypted or invalid PowerPoint document.')
                content = container.openstream('PowerPoint Document').read()
                offset, document = 0, False
                while offset < len(content):
                    if len(content) - offset < 8:
                        raise ValueError('Truncated record.')
                    _, record_type, length = struct.unpack_from('<HHI', content, offset)
                    if length > len(content) - offset - 8:
                        raise ValueError('Truncated record.')
                    document |= record_type == 1000
                    offset += length + 8
                if not document:
                    raise ValueError('Missing PowerPoint document.')
            if container.parsing_issues:
                raise ValueError('Malformed container.')
    except (OSError, ValueError, KeyError, struct.error) as error:
        raise AttachmentError('The legacy Office file is invalid, encrypted, or contains unsupported active content.', 'INVALID_FILE_CONTENT') from error
    finally:
        stream.seek(0)
    return dict(original_filename=filename, mime_type=legacy[kind][1], file_size=size, sha256=digest.hexdigest()), extension
