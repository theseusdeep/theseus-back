import pdf from 'html-pdf';
import showdown from 'showdown';

const enhancedCSS = `<style>
  @page {
    margin: 25mm 20mm;
    size: A4;
  }
  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #444;
    line-height: 1.8;
    margin: 0;
    padding: 0;
    font-size: 12pt;
    background-color: #fff;
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: 'Montserrat', sans-serif;
    margin-top: 0;
    line-height: 1.2;
    color: #2C3E50;
  }
  h1 {
    font-size: 28pt;
    text-align: center;
    border-bottom: 2px solid #bdc3c7;
    padding-bottom: 10px;
    margin-bottom: 20px;
  }
  h2 {
    font-size: 22pt;
    border-bottom: 1px solid #bdc3c7;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  h3 {
    font-size: 18pt;
    margin-bottom: 14px;
  }
  p {
    text-align: justify;
    margin-bottom: 16px;
  }
  ul, ol {
    margin: 0 0 16px 30px;
  }
  li {
    margin-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
  }
  th, td {
    border: 1px solid #bdc3c7;
    padding: 12px;
    text-align: left;
  }
  th {
    background-color: #ecf0f1;
    font-weight: bold;
  }
  tr:nth-child(even) {
    background-color: #f8f8f8;
  }
  blockquote {
    border-left: 5px solid #3498db;
    padding: 15px;
    background-color: #f0f8ff;
    margin: 20px 0;
    font-style: italic;
    color: #555;
  }
  code {
    font-family: 'Courier New', Courier, monospace;
    background-color: #f4f4f4;
    padding: 4px;
    border-radius: 4px;
    font-size: 10pt;
  }
  pre {
    background-color: #f4f4f4;
    padding: 15px;
    border-radius: 6px;
    overflow-x: auto;
    font-family: 'Courier New', Courier, monospace;
    font-size: 10pt;
    margin: 20px 0;
    border: 1px solid #e0e0e0;
  }
  a {
    color: #2980b9;
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
  img {
    max-width: 100%;
    height: auto;
    margin: 20px auto;
    display: block;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  }
  hr {
    border: none;
    border-top: 1px solid #bdc3c7;
    margin: 30px 0;
  }
  .page-header, .page-footer {
    width: 100%;
    text-align: center;
    color: #95a5a6;
    font-size: 9pt;
  }
  .page-header {
    border-bottom: 1px solid #bdc3c7;
    padding-bottom: 5px;
  }
  .page-footer {
    border-top: 1px solid #bdc3c7;
    padding-top: 5px;
  }
  .toc {
    margin: 30px 0;
    padding: 20px;
    background-color: #f9f9f9;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  .toc-title {
    font-size: 20pt;
    color: #34495e;
    margin-bottom: 16px;
  }
  .toc ul {
    list-style: none;
    padding-left: 0;
  }
  .toc li {
    margin-bottom: 8px;
  }
  .toc a {
    text-decoration: none;
    color: #2980b9;
  }
  .highlight-box {
    background-color: #e8f5e9;
    border-left: 6px solid #27ae60;
    padding: 15px;
    margin: 20px 0;
    border-radius: 4px;
  }
  .warning-box {
    background-color: #fff3e0;
    border-left: 6px solid #f39c12;
    padding: 15px;
    margin: 20px 0;
    border-radius: 4px;
  }
</style>`;

const headerFooterScript = `
<script>
  document.addEventListener('DOMContentLoaded', function() {
    const headings = document.querySelectorAll('h1, h2, h3');
    if (headings.length > 3) {
      const toc = document.createElement('div');
      toc.className = 'toc';
      const tocTitle = document.createElement('div');
      tocTitle.className = 'toc-title';
      tocTitle.textContent = 'Table of Contents';
      toc.appendChild(tocTitle);
      const tocList = document.createElement('ul');
      let currentList = tocList;
      let prevLevel = 1;
      headings.forEach((heading, index) => {
        if (index === 0) return;
        const level = parseInt(heading.tagName.substring(1));
        const listItem = document.createElement('li');
        const link = document.createElement('a');
        if (!heading.id) {
          heading.id = 'toc-heading-' + index;
        }
        link.href = '#' + heading.id;
        link.textContent = heading.textContent;
        listItem.appendChild(link);
        if (level > prevLevel) {
          const nestedList = document.createElement('ul');
          currentList.lastElementChild.appendChild(nestedList);
          currentList = nestedList;
        } else if (level < prevLevel) {
          for (let i = 0; i < (prevLevel - level); i++) {
            currentList = currentList.parentElement.parentElement;
          }
        }
        currentList.appendChild(listItem);
        prevLevel = level;
      });
      toc.appendChild(tocList);
      const firstHeading = document.querySelector('h1');
      if (firstHeading && firstHeading.nextElementSibling) {
        firstHeading.parentElement.insertBefore(toc, firstHeading.nextElementSibling);
      }
    }
  });
</script>
`;

const pdfOptions = {
  format: 'A4',
  orientation: 'portrait',
  border: {
    top: '25mm',
    right: '20mm',
    bottom: '25mm',
    left: '20mm',
  },
  header: {
    height: '15mm',
    contents: {
      default: '<div class="page-header">Theseus Deep Research Report</div>',
    },
  },
  footer: {
    height: '15mm',
    contents: {
      default: '<div class="page-footer">Page {{page}} of {{pages}}</div>',
      first: '<div class="page-footer">Page {{page}} of {{pages}} | Generated by Theseus Deep</div>',
    },
  },
  renderDelay: 1000,
  zoomFactor: '1',
  quality: '100',
  type: 'pdf',
  timeout: 120000, // 2 minutes
};

export const generatePDF = (reportTitle: string, reportMarkdown: string, researchId: string): Promise<Buffer> => {
  const converter = new showdown.Converter({
    tables: true,
    ghCompatibleHeaderId: true,
    strikethrough: true,
    tasklists: true,
    simpleLineBreaks: true,
    emoji: true,
  });
  const htmlContent = converter.makeHtml(reportMarkdown);

  // Add metadata and timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const metadata = `
    <div style="margin-bottom: 30px; text-align: right; color: #7f8c8d; font-size: 10pt;">
      <div>Report ID: ${researchId}</div>
      <div>Generated: ${new Date().toLocaleString()}</div>
    </div>
  `;

  // Create table of contents placeholder if the report is large
  const toc = reportMarkdown.length > 1000 ? `<div id="toc-placeholder"></div>` : '';

  const finalHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${reportTitle}</title>
      ${enhancedCSS}
    </head>
    <body>
      ${metadata}
      ${htmlContent}
      ${toc}
      ${headerFooterScript}
    </body>
    </html>
  `;

  return new Promise<Buffer>((resolve, reject) => {
    pdf.create(finalHtml, pdfOptions).toBuffer((err, buffer) => {
      if (err) {
        reject(err);
      } else {
        resolve(buffer);
      }
    });
  });
};
