import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'net';
import { basename, extname } from 'path';

const ALLOWED_DOCUMENT_TYPES = new Map<string, string[]>([
  ['application/pdf', ['.pdf']],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ['.docx'],
  ],
  ['text/plain', ['.txt']],
  ['text/markdown', ['.md', '.markdown']],
  ['application/json', ['.json']],
]);
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const MAX_DOCX_ENTRIES = 1_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 100;
const DANGEROUS_ARCHIVE_EXTENSIONS = new Set([
  '.bat',
  '.cmd',
  '.com',
  '.dll',
  '.exe',
  '.hta',
  '.jar',
  '.js',
  '.lnk',
  '.msi',
  '.ps1',
  '.scr',
  '.sh',
  '.vbs',
]);

export type DocumentScanStatus = 'clean' | 'skipped';

@Injectable()
export class BriefDocumentSecurityService {
  constructor(private readonly config: ConfigService) {}

  async validateAndScan(file: Express.Multer.File): Promise<{
    fileName: string;
    mimeType: string;
    scanStatus: DocumentScanStatus;
  }> {
    const fileName = this.safeFileName(file.originalname);
    const mimeType = file.mimetype.toLowerCase().split(';', 1)[0];
    this.assertTypeMatchesContent(fileName, mimeType, file.buffer);
    const scanStatus = await this.scanForMalware(file.buffer);
    return { fileName, mimeType, scanStatus };
  }

  private safeFileName(value: string | undefined) {
    const normalized = basename(
      value?.normalize('NFKC') || 'requirements-document',
    )
      .split('')
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join('')
      .trim();
    if (!normalized) return 'requirements-document';
    return normalized.slice(-255);
  }

  private assertTypeMatchesContent(
    fileName: string,
    mimeType: string,
    content: Buffer,
  ) {
    const extensions = ALLOWED_DOCUMENT_TYPES.get(mimeType);
    if (!extensions) {
      throw new BadRequestException(
        'Requirements documents must be PDF, DOCX, TXT, Markdown, or JSON files',
      );
    }
    const extension = extname(fileName).toLowerCase();
    if (!extensions.includes(extension)) {
      throw new BadRequestException(
        `The file extension does not match its declared ${mimeType} content type`,
      );
    }
    if (content.length === 0) {
      throw new BadRequestException('The requirements document is empty');
    }

    if (mimeType === 'application/pdf') {
      if (!content.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new BadRequestException('The uploaded file is not a valid PDF');
      }
      return;
    }
    if (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      this.assertSafeDocx(content);
      return;
    }
    if (content.includes(0)) {
      throw new BadRequestException(
        'Text requirements documents cannot contain binary data',
      );
    }
    const text = new TextDecoder('utf-8', { fatal: true });
    let decoded: string;
    try {
      decoded = text.decode(content);
    } catch {
      throw new BadRequestException(
        'Text requirements documents must use valid UTF-8 encoding',
      );
    }
    if (mimeType === 'application/json') {
      try {
        JSON.parse(decoded);
      } catch {
        throw new BadRequestException(
          'The requirements JSON document is not valid JSON',
        );
      }
    }
  }

  private assertSafeDocx(content: Buffer) {
    if (content.length < 22 || content.readUInt32LE(0) !== 0x04034b50) {
      throw new BadRequestException('The uploaded file is not a valid DOCX');
    }
    const eocdOffset = this.findEndOfCentralDirectory(content);
    if (eocdOffset < 0) {
      throw new BadRequestException('The DOCX archive is incomplete');
    }
    const diskNumber = content.readUInt16LE(eocdOffset + 4);
    const centralDisk = content.readUInt16LE(eocdOffset + 6);
    const entries = content.readUInt16LE(eocdOffset + 10);
    const centralSize = content.readUInt32LE(eocdOffset + 12);
    const centralOffset = content.readUInt32LE(eocdOffset + 16);
    if (diskNumber !== 0 || centralDisk !== 0) {
      throw new BadRequestException(
        'Multi-volume DOCX archives are not allowed',
      );
    }
    if (entries === 0 || entries > MAX_DOCX_ENTRIES) {
      throw new BadRequestException(
        'The DOCX archive has an unsafe entry count',
      );
    }
    if (centralOffset + centralSize > eocdOffset) {
      throw new BadRequestException('The DOCX archive directory is malformed');
    }

    let offset = centralOffset;
    let totalCompressed = 0;
    let totalUncompressed = 0;
    let hasContentTypes = false;
    let hasDocumentXml = false;
    for (let index = 0; index < entries; index += 1) {
      if (
        offset + 46 > content.length ||
        content.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE
      ) {
        throw new BadRequestException(
          'The DOCX archive directory is malformed',
        );
      }
      const flags = content.readUInt16LE(offset + 8);
      const compressedSize = content.readUInt32LE(offset + 20);
      const uncompressedSize = content.readUInt32LE(offset + 24);
      const nameLength = content.readUInt16LE(offset + 28);
      const extraLength = content.readUInt16LE(offset + 30);
      const commentLength = content.readUInt16LE(offset + 32);
      const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
      if (entryEnd > content.length) {
        throw new BadRequestException(
          'The DOCX archive directory is malformed',
        );
      }
      if ((flags & 1) !== 0) {
        throw new BadRequestException('Encrypted DOCX files are not supported');
      }
      const name = content
        .subarray(offset + 46, offset + 46 + nameLength)
        .toString('utf8')
        .replace(/\\/g, '/');
      if (
        name.startsWith('/') ||
        name.includes('../') ||
        name.includes('\u0000')
      ) {
        throw new BadRequestException(
          'The DOCX archive contains an unsafe path',
        );
      }
      const lowerName = name.toLowerCase();
      if (
        lowerName.endsWith('vbaproject.bin') ||
        DANGEROUS_ARCHIVE_EXTENSIONS.has(extname(lowerName))
      ) {
        throw new BadRequestException(
          'The DOCX archive contains executable or macro content',
        );
      }
      hasContentTypes ||= name === '[Content_Types].xml';
      hasDocumentXml ||= lowerName === 'word/document.xml';
      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) {
        throw new BadRequestException(
          'The DOCX expands beyond the safe processing limit',
        );
      }
      offset = entryEnd;
    }
    const ratio = totalUncompressed / Math.max(1, totalCompressed);
    if (ratio > MAX_DOCX_COMPRESSION_RATIO) {
      throw new BadRequestException(
        'The DOCX compression ratio exceeds the safe processing limit',
      );
    }
    if (!hasContentTypes || !hasDocumentXml) {
      throw new BadRequestException(
        'The DOCX does not contain a Word document payload',
      );
    }
  }

  private findEndOfCentralDirectory(content: Buffer) {
    const minimum = Math.max(0, content.length - 65_557);
    for (let offset = content.length - 22; offset >= minimum; offset -= 1) {
      if (content.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
    }
    return -1;
  }

  private async scanForMalware(content: Buffer): Promise<DocumentScanStatus> {
    const host = this.config.get<string>('CLAMAV_HOST')?.trim();
    const required =
      (this.config.get<string>('REQUIREMENTS_DOCUMENT_MALWARE_SCAN_REQUIRED') ??
        (this.config.get<string>('NODE_ENV') === 'production'
          ? 'true'
          : 'false')) === 'true';
    if (!host) {
      if (required) {
        throw new ServiceUnavailableException(
          'Requirements document malware scanning is not configured',
        );
      }
      return 'skipped';
    }

    const port = Number(this.config.get<string>('CLAMAV_PORT') ?? 3310);
    const timeoutMs = Number(
      this.config.get<string>('CLAMAV_TIMEOUT_MS') ?? 15_000,
    );
    const result = await this.clamAvInstream(content, host, port, timeoutMs);
    if (/\bFOUND\b/.test(result)) {
      throw new BadRequestException(
        'The requirements document failed the malware scan',
      );
    }
    if (!/\bOK\b/.test(result)) {
      if (required) {
        throw new ServiceUnavailableException(
          'The malware scanner could not verify this document',
        );
      }
      return 'skipped';
    }
    return 'clean';
  }

  private clamAvInstream(
    content: Buffer,
    host: string,
    port: number,
    timeoutMs: number,
  ) {
    return new Promise<string>((resolve, reject) => {
      const socket = new Socket();
      const response: Buffer[] = [];
      const fail = (error: Error) => {
        socket.destroy();
        reject(
          new ServiceUnavailableException(
            `Requirements document malware scan failed: ${error.message}`,
          ),
        );
      };
      socket.setTimeout(timeoutMs, () => fail(new Error('scanner timeout')));
      socket.once('error', fail);
      socket.on('data', (chunk: Buffer) => response.push(chunk));
      socket.once('close', () => resolve(Buffer.concat(response).toString()));
      socket.connect(port, host, () => {
        socket.write(Buffer.from('zINSTREAM\0'));
        for (let offset = 0; offset < content.length; offset += 64 * 1024) {
          const chunk = content.subarray(offset, offset + 64 * 1024);
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}
