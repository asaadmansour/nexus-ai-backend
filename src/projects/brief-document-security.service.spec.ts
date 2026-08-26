import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BriefDocumentSecurityService } from './brief-document-security.service';

function file(
  originalname: string,
  mimetype: string,
  buffer: Buffer,
): Express.Multer.File {
  return {
    originalname,
    mimetype,
    buffer,
    size: buffer.length,
  } as Express.Multer.File;
}

function fakeDocx(
  entries: Array<{ name: string; compressed: number; size: number }>,
) {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(0x04034b50);
  const central = entries.map((entry) => {
    const name = Buffer.from(entry.name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt32LE(entry.compressed, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(name.length, 28);
    return Buffer.concat([header, name]);
  });
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(prefix.length, 16);
  return Buffer.concat([prefix, directory, eocd]);
}

describe('BriefDocumentSecurityService', () => {
  const service = new BriefDocumentSecurityService(
    new ConfigService({
      NODE_ENV: 'test',
      REQUIREMENTS_DOCUMENT_MALWARE_SCAN_REQUIRED: 'false',
    }),
  );

  it('rejects a spoofed PDF before it reaches storage or AI', async () => {
    await expect(
      service.validateAndScan(
        file('requirements.pdf', 'application/pdf', Buffer.from('not a pdf')),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires valid UTF-8 and valid JSON for JSON documents', async () => {
    await expect(
      service.validateAndScan(
        file('requirements.json', 'application/json', Buffer.from('{broken')),
      ),
    ).rejects.toThrow('not valid JSON');
  });

  it('accepts a structurally bounded DOCX and records a skipped local scan', async () => {
    const result = await service.validateAndScan(
      file(
        '../requirements.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fakeDocx([
          { name: '[Content_Types].xml', compressed: 100, size: 200 },
          { name: 'word/document.xml', compressed: 100, size: 500 },
        ]),
      ),
    );
    expect(result.fileName).toBe('requirements.docx');
    expect(result.scanStatus).toBe('skipped');
  });

  it('rejects DOCX zip bombs and macro payloads', async () => {
    await expect(
      service.validateAndScan(
        file(
          'requirements.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fakeDocx([
            { name: '[Content_Types].xml', compressed: 1, size: 1 },
            { name: 'word/document.xml', compressed: 1, size: 10_000 },
          ]),
        ),
      ),
    ).rejects.toThrow('compression ratio');

    await expect(
      service.validateAndScan(
        file(
          'requirements.docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fakeDocx([
            { name: '[Content_Types].xml', compressed: 10, size: 10 },
            { name: 'word/document.xml', compressed: 10, size: 10 },
            { name: 'word/vbaProject.bin', compressed: 10, size: 10 },
          ]),
        ),
      ),
    ).rejects.toThrow('macro');
  });
});
