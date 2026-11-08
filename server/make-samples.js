// Generates realistic sample exports: node server/make-samples.js
import * as XLSX from 'xlsx';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const out = fileURLToPath(new URL('../sample_data/', import.meta.url));
fs.mkdirSync(out, { recursive: true });

function write(name, title, headers, rows) {
  // mimic Salesforce dumps: blank rows + offset columns + title line
  const aoa = [[], ['', '', title], [], ['', '', ...headers], ...rows.map((r) => ['', '', ...r])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  XLSX.writeFile(wb, out + name);
  console.log('wrote', name);
}

write('DSO_export.xlsx', 'DSO System Template (dumping)',
  ['Service Request', 'Service Request#', 'Company Name', 'Step Status', 'Created Date', 'Created By Alias', 'Owner First NameSorted Descending', 'Owner Last Name', 'Parent Service Template Code'],
  [
    ['SR-Ref-282734', 'DSO-LIC-225856', 'KELIDA CONSTRUCTION - FZCO', 'Pending Review', '11/5/2026', 'Mzim', 'Susan', 'Jacob', 'IFZA_LICENSE_RENEWAL'],
    ['SR-Ref-540277', 'DSO-LIC-279413', 'SUBECOM TRADING - FZCO', 'Pending Review', '11/2/2026', 'buser', 'Firas', 'Essghaier', 'IFZA_COMPANY_APPLICATION'],
    ['SR-Ref-441435', 'DSO-LIC-277998', 'NAVI TRADE AND TRANSPORT - FZCO', 'Pending Review', '11/6/2026', 'Gard', '', '', 'IFZA_LICENSE_RENEWAL'],
    ['SR-Ref-441500', 'DSO-LIC-278100', 'ORBIT GENERAL TRADING - FZCO', 'Pending Review', '11/3/2026', 'buser', 'Firas', 'Essghaier', 'IFZA_SHA_COA_TEMPLATE'],
    ['SR-Ref-441501', 'DSO-LIC-278101', 'PEARL TECH - FZCO', 'Pending Review', '11/4/2026', 'buser', 'Firas', 'Essghaier', 'UBO Amendment'],
    ['SR-Ref-441502', 'DSO-LIC-278102', 'OLD RECORD - FZCO', 'Pending Review', '8/1/2026', 'buser', 'Firas', 'Essghaier', 'IFZA_SHAREHOLDER_AMENDMENT'],
    ['SR-Ref-282734', 'DSO-LIC-225856', 'KELIDA CONSTRUCTION - FZCO', 'Pending Review', '11/5/2026', 'Mzim', 'Susan', 'Jacob', 'IFZA_LICENSE_RENEWAL'],
  ]);

write('DAFZ_export.xlsx', 'DAFZ System Template (dumping)',
  ['Request Step Template Name', 'Service Number', 'Account Name', 'Service Step Number', 'Request Status Name', 'Stage Owner', 'Request Template: Name', 'Created Date', 'Closed Date', 'Owner name', 'Service Step Status: Status Name', 'Closed Date Time'],
  [
    ['Enhanced Due Diligence', 'DAFZ-1789470', 'INNOVATION TELECOM FZCO', 'SSN-2445579', 'Completed', 'Integration User', 'UBO Declaration Service', '9/9/2026', '9/18/2026', 'Aditi Mathur', 'Completed', '18/09/2026, 08:52'],
    ['Enhanced Due Diligence', 'DAFZ-1789624', 'Cenwood Telecom FZCO', 'SSN-2446076', 'Completed', 'Integration User', 'UBO Declaration Service', '9/9/2026', '9/11/2026', 'Aditi Mathur', 'Completed', '11/09/2026, 12:15'],
    ['Enhanced Due Diligence', 'DAFZ-1789631', 'Acloud Digital FZCO', 'SSN-2447411', 'Completed', 'Integration User', 'UBO Declaration Service', '9/10/2026', '9/21/2026', 'Mathew Kappil James', 'Completed', '21/09/2026, 08:52'],
    ['Enhanced Due Diligence', 'DAFZ-1790001', 'Sunrise Foods FZCO', 'SSN-2450001', 'In Progress', 'Compliance', 'DAFZ License Renewal', '10/28/2026', '', 'Mathew Kappil James', 'Pending', ''],
    ['Enhanced Due Diligence', 'DAFZ-1790002', 'Vertex Metals FZCO', 'SSN-2450002', 'In Progress', 'Compliance', 'DAFZ Company Officer Amendment', '10/30/2026', '', 'Aditi Mathur', 'Pending', ''],
  ]);

write('DCC_export.xlsx', 'DCC System Template (dumping)',
  ['Account Name', 'Step Number', 'Request Number', 'Created Date', 'Request Step Template: Step Template Number', 'Request Template: Name', 'Owner name', 'Stage Owner', 'Request Step ID', 'Request Step Status: Status Name', 'Owner: Full Name', 'Closed Date Time'],
  [
    ['Global Biopolymers Industries PTE LTD (Branch)', 'RS-192639', 'DCC-081592', '22/07/2026', 'Enhanced Due Diligence', 'License Renewal', 'Mathew Kappil James', 'Customer', 'a1ESi000006mtoM', 'Completed', 'Mathew Kappil James', '22/07/2026, 12:54'],
    ['KINNARPS PROJECT SOLUTIONS FZCO', 'RS-154543', 'DCC-069098', '22/12/2025', 'Enhanced Due Diligence', 'Company Application', 'Mathew Kappil James', 'DCC Facility Management Team', 'a1EdP000004KifJ', 'Completed', 'Mathew Kappil James', '22/12/2025, 13:05'],
    ['Albastaki and Aljassmy Consultancy FZCO', 'RS-135431', 'DCC-060857', '11/09/2025', 'Enhanced Due Diligence', 'DCC Company Name Change', 'Aditi Mathur', 'Customer', 'a1EdP000003Pmyz', 'Completed', 'Aditi Mathur', '15/09/2025, 10:05'],
    ['ALPHA STEEL PIPING SUPPLIES FZCO', 'RS-152483', 'DCC-062054', '08/12/2025', 'Enhanced Due Diligence', 'License Renewal', 'Aditi Mathur', 'Customer', 'a1EdP000004EFL3', 'Completed', 'Aditi Mathur', '14/09/2026, 09:43'],
    ['NOVA LOGISTICS FZCO', 'RS-199001', 'DCC-090001', '02/11/2026', 'Enhanced Due Diligence', 'Activity Amendment', 'Aditi Mathur', 'Compliance', 'a1EdP000009XXXX', 'Pending', 'Aditi Mathur', ''],
  ]);
