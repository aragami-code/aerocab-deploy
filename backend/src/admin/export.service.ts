import { Injectable } from '@nestjs/common';

export interface ExportRow {
  [key: string]: string | number | null | undefined;
}

@Injectable()
export class ExportService {
  // ── PDF ────────────────────────────────────────────────────────────────────

  async buildPdf(
    title: string,
    subtitle: string,
    headers: string[],
    rows: (string | number | null | undefined)[][],
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      // eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width - 60;
      const colW = W / headers.length;

      // Header
      doc.fontSize(16).fillColor('#1a1a2e').text('AeroCab Connect', 30, 30);
      doc.fontSize(12).fillColor('#444').text(title, 30, 52);
      doc.fontSize(9).fillColor('#888').text(subtitle, 30, 70);

      // Separator
      doc.moveTo(30, 86).lineTo(30 + W, 86).lineWidth(1).strokeColor('#1a1a2e').stroke();

      // Table header
      let y = 96;
      doc.rect(30, y, W, 18).fill('#1a1a2e');
      doc.fillColor('#fff').fontSize(8);
      headers.forEach((h, i) => {
        doc.text(h, 34 + i * colW, y + 5, { width: colW - 4, ellipsis: true });
      });

      // Table rows
      y += 18;
      rows.forEach((row, ri) => {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 30;
        }
        const bg = ri % 2 === 0 ? '#f8f8f8' : '#fff';
        doc.rect(30, y, W, 16).fill(bg);
        doc.fillColor('#333').fontSize(7.5);
        row.forEach((cell, i) => {
          const val = cell === null || cell === undefined ? '—' : String(cell);
          doc.text(val, 34 + i * colW, y + 4, { width: colW - 4, ellipsis: true });
        });
        y += 16;
      });

      // Footer
      doc.moveTo(30, y + 8).lineTo(30 + W, y + 8).lineWidth(0.5).strokeColor('#ccc').stroke();
      doc.fillColor('#aaa').fontSize(8).text(
        `AeroCab Connect · export automatique · ${new Date().toLocaleString('fr-FR')}`,
        30, y + 12,
      );

      doc.end();
    });
  }

  // ── XLSX ───────────────────────────────────────────────────────────────────

  async buildXlsx(
    sheetName: string,
    headers: { header: string; key: string; width?: number }[],
    rows: ExportRow[],
  ): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'AeroCab Connect';
    wb.created = new Date();

    const ws = wb.addWorksheet(sheetName);

    ws.columns = headers.map((h) => ({
      header: h.header,
      key: h.key,
      width: h.width ?? 20,
    }));

    // Style header row
    ws.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1a1a2e' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
    ws.getRow(1).height = 20;

    // Add data rows
    rows.forEach((row, ri) => {
      const r = ws.addRow(row);
      if (ri % 2 === 0) {
        r.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F8F8' } };
        });
      }
    });

    // Auto-filter
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };

    return wb.xlsx.writeBuffer().then((ab) => Buffer.from(ab));
  }
}
