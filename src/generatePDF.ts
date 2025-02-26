import puppeteer from 'puppeteer';
import showdown from 'showdown';

const enhancedCSS = `<style>
  @page {
    margin: 25mm 20mm;
    size: A4;
  }
  html, body {
    width: 100%;
    height: auto;
    overflow: visible !important;
  }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #444;
    line-height: 1.8;
    margin: 0;
    padding: 0;
    font-size: 12pt;
    background-color: #fff;
  }
  h1, h2, h3, h4, h5, h6 {
    margin-top: 0;
    line-height: 1.2;
    color: #2C3E50;
    page-break-inside: avoid;
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
    page-break-inside: avoid;
  }
  ul, ol {
    margin: 0 0 16px 30px;
    page-break-inside: avoid;
  }
  li {
    margin-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    page-break-inside: auto;
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
    page-break-inside: avoid;
  }
  code {
    font-family: "Courier New", Courier, monospace;
    background-color: #f4f4f4;
    padding: 4px;
    border-radius: 4px;
    font-size: 10pt;
    page-break-inside: avoid;
  }
  pre {
    background-color: #f4f4f4;
    padding: 15px;
    border-radius: 6px;
    overflow-x: auto;
    font-family: "Courier New", Courier, monospace;
    font-size: 10pt;
    margin: 20px 0;
    border: 1px solid #e0e0e0;
    page-break-inside: avoid;
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
    page-break-inside: avoid;
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

export const generatePDF = async (reportTitle: string, reportMarkdown: string, researchId: string): Promise<Buffer> => {
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

  // Table of Contents script with a completion flag
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
    window.tocGenerated = true;
  });
</script>
`;

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
      ${headerFooterScript}
    </body>
    </html>
  `;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Make sure to emulate screen media so we get our full CSS
  await page.emulateMediaType('screen');

  // Log console messages for debugging
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.setContent(finalHtml, { waitUntil: 'networkidle0' });

  // Wait for TOC generation, with a fallback
  try {
    await page.waitForFunction('window.tocGenerated === true', { timeout: 10000 });
  } catch (error) {
    console.warn('TOC generation timed out, proceeding without TOC.');
  }

  const pdfBuffer = await page.pdf({
    printBackground: true,
    margin: {
      top: '25mm',
      right: '20mm',
      bottom: '25mm',
      left: '20mm',
    },
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size: 9pt; width: 100%; text-align: center; color: #95a5a6; border-bottom: 1px solid #bdc3c7; padding-bottom: 5px;">Theseus Deep Research Report</div>',
    footerTemplate: '<div style="font-size: 9pt; width: 100%; text-align: center; color: #95a5a6; border-top: 1px solid #bdc3c7; padding-top: 5px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    preferCSSPageSize: true,
    timeout: 120000,
  });

  await browser.close();

  return pdfBuffer;
};
