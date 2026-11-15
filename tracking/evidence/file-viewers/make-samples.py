# ADR-0106 walk samples: small Word, Excel, PowerPoint, PDF, ZIP, code and UTF-16 files,
# some carrying content a viewer must not run or fetch (scripts, an outside link and picture).
import io, os, zipfile, struct, zlib, sys
from docx import Document
from docx.shared import Inches
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches as PI
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

out = sys.argv[1] if len(sys.argv) > 1 else 'samples'
os.makedirs(out, exist_ok=True)
p = lambda n: os.path.join(out, n)

def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

img = io.BytesIO(png(120, 60, (60, 140, 100)))

d = Document()
d.add_heading('Clinic reminder pilot', 0)
d.add_paragraph('A short report with a heading, a list, a table and a picture.')
for x in ['Turn on reminders at one clinic', 'Send them 48 hours ahead', 'Count replies for four weeks']:
    d.add_paragraph(x, style='List Bullet')
t = d.add_table(rows=3, cols=3)
t.style = 'Table Grid'
for i, row in enumerate([['Week', 'Booked', 'Unused'], ['1', '42', '7'], ['2', '45', '4']]):
    for j, v in enumerate(row):
        t.cell(i, j).text = v
d.add_picture(img, width=Inches(2))
d.add_page_break()
d.add_heading('Second page', 1)
d.add_paragraph('Text on the second page.')
d.save(p('report.docx'))

# The same document with an outside hyperlink and an outside (linked) picture added.
with zipfile.ZipFile(p('report.docx')) as z:
    parts = {n: z.read(n) for n in z.namelist()}
rels = parts['word/_rels/document.xml.rels'].decode()
rels = rels.replace('</Relationships>',
  '<Relationship Id="rIdX1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://127.0.0.1:9/tracker-link" TargetMode="External"/>'
  '<Relationship Id="rIdX2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://127.0.0.1:9/tracker.png" TargetMode="External"/></Relationships>')
parts['word/_rels/document.xml.rels'] = rels.encode()
doc = parts['word/document.xml'].decode()
link = ('<w:p><w:hyperlink r:id="rIdX1"><w:r><w:t>An outside link (must not open)</w:t></w:r></w:hyperlink></w:p>')
pic = doc[doc.index('<w:drawing>'):doc.index('</w:drawing>') + len('</w:drawing>')].replace('r:embed=', 'r:link="rIdX2" r:x=')
doc = doc.replace('<w:body>', '<w:body>' + link + '<w:p><w:r>' + pic + '</w:r></w:p>', 1)
parts['word/document.xml'] = doc.encode()
with zipfile.ZipFile(p('outside-links.docx'), 'w', zipfile.ZIP_DEFLATED) as z:
    for n, b in parts.items():
        z.writestr(n, b)

wb = Workbook()
ws = wb.active
ws.title = 'Slots'
ws.append(['Clinic', 'Week', 'Booked', 'Unused', 'Share unused'])
for i, (c, w, b, u) in enumerate([('North', 1, 42, 7), ('North', 2, 45, 4), ('South', 1, 30, 9), ('South', 2, 33, 5)], start=2):
    ws.append([c, w, b, u, f'=D{i}/C{i}'])
    ws[f'E{i}'].number_format = '0.0%'
ws2 = wb.create_sheet('Notes')
ws2['B3'] = 'Starts at B3'
ws2['C4'] = 1234.5
ws2['C4'].number_format = '$#,##0.00'
wb.save(p('slots.xlsx'))

pr = Presentation()
s = pr.slides.add_slide(pr.slide_layouts[0])
s.shapes.title.text = 'Reminder pilot'
s.placeholders[1].text = 'Results after four weeks'
s = pr.slides.add_slide(pr.slide_layouts[1])
s.shapes.title.text = 'What we did'
tf = s.placeholders[1].text_frame
tf.text = 'Turned on reminders'
para = tf.add_paragraph(); para.text = 'At one clinic first'; para.level = 1
s.notes_slide.notes_text_frame.text = 'Mention the opt-out rate.'
s = pr.slides.add_slide(pr.slide_layouts[5])
s.shapes.title.text = 'Numbers'
img.seek(0)
s.shapes.add_picture(img, PI(1), PI(2), width=PI(3))
tb = s.shapes.add_table(2, 2, PI(5), PI(2), PI(3), PI(1)).table
tb.cell(0, 0).text = 'Before'; tb.cell(0, 1).text = 'After'
tb.cell(1, 0).text = '16'; tb.cell(1, 1).text = '9'
# The same picture again on the first slide (one media part used twice; review L-4).
img.seek(0)
pr.slides[0].shapes.add_picture(img, PI(7), PI(0.3), width=PI(1))
pr.save(p('pilot.pptx'))

# A small PowerPoint whose one extra part inflates to 100 MiB (review L-1): refused unopened.
with zipfile.ZipFile(p('pilot.pptx')) as z:
    parts = {n: z.read(n) for n in z.namelist()}
with zipfile.ZipFile(p('bomb.pptx'), 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for n, b in parts.items():
        z.writestr(n, b)
    z.writestr('ppt/slides/slide99.xml', b' ' * (100 * 1024 * 1024))

# The same, but every header says that part is 1,000 bytes (re-review L-1): only inflating it
# shows it is not, so the studio inflates each part once, counting, before a viewer opens it.
def understate(src, dst, part, size):
    data = bytearray(open(src, 'rb').read())
    name = part.encode()
    i = data.find(b'PK\x01\x02')
    while i >= 0:
        n = struct.unpack('<H', data[i + 28:i + 30])[0]
        if data[i + 46:i + 46 + n] == name:
            struct.pack_into('<I', data, i + 24, size)
            local = struct.unpack('<I', data[i + 42:i + 46])[0]
            struct.pack_into('<I', data, local + 22, size)
        i = data.find(b'PK\x01\x02', i + 4)
    open(dst, 'wb').write(bytes(data))
understate(p('bomb.pptx'), p('liar.pptx'), 'ppt/slides/slide99.xml', 1000)

# Eighty pages, to check that pages scrolled past give back their canvases (review M-1).
c = canvas.Canvas(p('many-pages.pdf'), pagesize=letter)
for i in range(80):
    c.setFont('Helvetica', 28); c.drawString(72, 700, f'Page {i + 1}')
    c.showPage()
c.save()

c = canvas.Canvas(p('two-pages.pdf'), pagesize=letter)
c.setFont('Helvetica-Bold', 22); c.drawString(72, 700, 'Clinic reminder pilot')
c.setFont('Helvetica', 12); c.drawString(72, 670, 'Selectable text on page one.')
c.rect(72, 500, 200, 120, stroke=1, fill=0)
c.showPage()
c.setFont('Times-Roman', 14); c.drawString(72, 700, 'Page two, in Times.')
c.save()
# A PDF with an OpenAction script (must never run).
js = b'''%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R/OpenAction 4 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 5 0 R/Resources<</Font<</F1 6 0 R>>>>>>endobj
4 0 obj<</S/JavaScript/JS(app.alert('pdf script ran'); this.submitForm('http://127.0.0.1:9/x');)>>endobj
5 0 obj<</Length 44>>stream
BT /F1 18 Tf 20 100 Td (Script stays off) Tj ET
endstream endobj
6 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 7>>
%%EOF
'''
open(p('script.pdf'), 'wb').write(js)

with zipfile.ZipFile(p('bundle.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('docs/', '')
    z.writestr('docs/readme.txt', 'hello ' * 100)
    z.writestr('src/main.py', 'print(1)\n')
    z.writestr('café.txt', 'utf-8 name')

open(p('analysis.py'), 'w').write('''"""Count unused first-appointment slots."""
from dataclasses import dataclass


@dataclass
class Week:
    booked: int
    unused: int  # slots nobody used

    def share(self) -> float:
        return self.unused / self.booked if self.booked else 0.0


WEEKS = [Week(42, 7), Week(45, 4)]
print(f"{sum(w.unused for w in WEEKS)} unused of {sum(w.booked for w in WEEKS)}")
''')
open(p('page.html'), 'w').write('<!doctype html>\n<html>\n<body onload="alert(1)">\n  <h1 class="title">Hi</h1>\n  <script>fetch("http://127.0.0.1:9/html")</script>\n  <img src="http://127.0.0.1:9/img.png">\n</body>\n</html>\n')
open(p('logo.svg'), 'w').write('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" onload="alert(1)">\n  <script>fetch("http://127.0.0.1:9/svg");document.title="RAN "+location.origin;fetch("http://127.0.0.1:5183/api/broker/status",{credentials:"include"}).then(function(r){document.title+=" | "+r.status},function(){document.title+=" | blocked"})</script>\n  <rect width="160" height="80" rx="12" fill="#3c8c64"/>\n  <image href="http://127.0.0.1:9/svg-img.png" width="10" height="10"/>\n  <text x="80" y="48" font-size="22" text-anchor="middle" fill="white">SVG</text>\n</svg>\n')
open(p('utf16.txt'), 'wb').write('﻿UTF-16 text: café, naïve, 日本語\r\nSecond line\r\n'.encode('utf-16-le'))
open(p('broken.json'), 'w').write('{"a": 1,,}')
