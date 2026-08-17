#!/usr/bin/env python3
"""Build a minimal but realistic trip-report .docx fixture."""
import zipfile, sys

PARAS = [
    "Trip Report - Exercise Bright Lantern",
    "Number of soldiers trained: 42",
    "Network SME (David Massey)",
    "Day One (3 March 2026)",
    "Set up the tactical network in the motor pool.",
    "Ran cable to the TOC.",
    "Day Two (4 March 2026)",
    "Configured the routers.",
    "Day Three (5 March 2026)",
    "Radio SME (Jane Q. Rivers)",
    "Day One (3 March 2026)",
    "Issued handhelds.",
    "Day Two (4 March 2026)",
    "Comms check across the range.",
]

def p(t):
    return ('<w:p><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>'
            % t.replace('&', '&amp;').replace('<', '&lt;'))

DOC = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
       '<w:body>' + ''.join(p(t) for t in PARAS) +
       '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>')

CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      '</Types>')

RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>')

out = sys.argv[1] if len(sys.argv) > 1 else 'trip_report.docx'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CT)
    z.writestr('_rels/.rels', RELS)
    z.writestr('word/document.xml', DOC)
print(out)
