import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill_hex)
    tcPr.append(shd)

doc = docx.Document()

# Page Margins
sections = doc.sections
for section in sections:
    section.top_margin = Inches(0.8)
    section.bottom_margin = Inches(0.8)
    section.left_margin = Inches(0.8)
    section.right_margin = Inches(0.8)

# Title
title_p = doc.add_paragraph()
title_p.paragraph_format.space_before = Pt(0)
title_p.paragraph_format.space_after = Pt(4)
title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run_title = title_p.add_run("LabMesh · Live Demo & Presentation Guide")
run_title.font.name = "Segoe UI"
run_title.font.size = Pt(22)
run_title.font.bold = True
run_title.font.color.rgb = RGBColor(16, 91, 73) # Emerald

sub_p = doc.add_paragraph()
sub_p.paragraph_format.space_after = Pt(16)
sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run_sub = sub_p.add_run("JIAT Hack Days Gampaha 2026 | Community Impact & Google Gemini Track")
run_sub.font.name = "Segoe UI"
run_sub.font.size = Pt(11)
run_sub.font.color.rgb = RGBColor(100, 116, 139)

# Section 1: Team & Roles
h1 = doc.add_heading("1. Team Members & Stage Presentation Roles", level=1)
h1.paragraph_format.space_before = Pt(12)
h1.paragraph_format.space_after = Pt(6)

table = doc.add_table(rows=1, cols=3)
table.alignment = WD_TABLE_ALIGNMENT.CENTER
table.autofit = False

hdr_cells = table.rows[0].cells
hdr_titles = ["Role & Member", "Responsibilities in Project", "Demo / Speaking Duty"]
widths = [Inches(1.8), Inches(2.8), Inches(2.2)]

for i, title in enumerate(hdr_titles):
    hdr_cells[i].text = title
    hdr_cells[i].width = widths[i]
    set_cell_background(hdr_cells[i], "165B49")
    p = hdr_cells[i].paragraphs[0]
    p.runs[0].font.bold = True
    p.runs[0].font.color.rgb = RGBColor(255, 255, 255)
    p.runs[0].font.name = "Segoe UI"
    p.runs[0].font.size = Pt(9.5)

roles_data = [
    ("Team Lead\n(Deshan)", "Signaling Coordinator (FastAPI), WebRTC Transport (RTCDataChannel), Extension Packaging, Gemini Integration.", "Introduces the classroom problem, explains P2P architecture, orchestrates the live laptop demo."),
    ("Backend Teammate\n(xDhanu)", "Transfer Engine (engine.js), Chunks Protocol, Rarest-First Scheduler, SHA-256 integrity verification.", "Explains chunk seeding (even/odd distribution), mutual link verification, and P2P reassembly."),
    ("Frontend Teammate\n(heshan)", "Extension Room UI (ui.js), CSS projector styling, chunk matrix strips, UI test harness.", "Controls the screens, points to live chunk matrix strips, highlights host departure, triggers Gemini AI Guide.")
]

for row_idx, row_data in enumerate(roles_data):
    row_cells = table.add_row().cells
    bg = "F8FAFC" if row_idx % 2 == 0 else "FFFFFF"
    for i, text in enumerate(row_data):
        row_cells[i].text = text
        row_cells[i].width = widths[i]
        p = row_cells[i].paragraphs[0]
        p.runs[0].font.name = "Segoe UI"
        p.runs[0].font.size = Pt(9)
        set_cell_background(row_cells[i], bg)

doc.add_paragraph().paragraph_format.space_after = Pt(10)

# Section 2: The 2-Minute Winning Pitch Script
h2 = doc.add_heading("2. The 2-Minute Live Demo Pitch Script (Turn-by-Turn)", level=1)
h2.paragraph_format.space_before = Pt(12)
h2.paragraph_format.space_after = Pt(6)

script_blocks = [
    ("0:00 - 0:30 | The Hook: The Sri Lankan Classroom Problem (Speaker: Team Lead)",
     "English Pitch:\n'Good afternoon judges! In Sri Lankan university and school computer labs, 30 students often share a single limited Wi-Fi connection. When the instructor asks everyone to download a 50MB starter kit at once, the internet connection completely collapses. The first 45 minutes of the workshop are lost to download spinners. We built LabMesh to solve this — zero-internet, local-first file distribution over WebRTC data channels.'\n\n"
     "Sinhala Explanation (for Q&A/Judges):\n'ලංකාවේ Computer labs වල ළමයි 30ක් එකම Wi-Fi එකෙන් 50MB starter kit එකක් download කරන්න ගියාම internet එක choke වෙනවා. මුල් විනාඩි 45ම නාස්ති වෙනවා. LabMesh කියන්නේ මේ ප්‍රශ්නයට pure local-first WebRTC peer-to-peer විසඳුමක්.'"),
    
    ("0:30 - 1:00 | The Setup & Staged Seeding (Speakers: Team Lead & Frontend)",
     "English Pitch:\n'Watch our 3 screens. Laptop A is the Instructor. Laptops B and C are students. All 3 laptops are connected to the room. When Instructor A selects our 1 MiB starter kit in Staged Mode, Laptop A doesn't flood the network. It seeds EVEN chunks to Student B, and ODD chunks to Student C. Look at the chunk strips on screen: B has pieces 0, 2, 4, 6... and C has pieces 1, 3, 5, 7... Neither student has the full file yet!'\n\n"
     "Live Action on Screen:\n• Laptop A creates room -> shows 8-char code.\n• B and C join using code -> mutual data channels established.\n• A selects demo/workshop.bin in Staged mode -> green cells fill on B (even) and C (odd).\n• Green banner pops up: 'Ready to disconnect the source'."),

    ("1:00 - 1:30 | The Climax: Host Disconnect & P2P Recovery! (Speaker: Backend)",
     "English Pitch:\n'Now, notice this green indicator: \"Ready to disconnect the source\". We invite the judge to close Laptop A's tab right now! (Judge closes A's tab). Laptop A is completely offline. In a traditional client-server system, the download would fail. But watch Laptops B and C: they immediately detect A's departure, discover each other's inventories over direct LAN WebRTC, and swap missing chunks peer-to-peer! Both bars reach 100% and turn to Verified!'\n\n"
     "Live Action on Screen:\n• Laptop A tab is closed or Wi-Fi turned off.\n• Laptop B & C detect A offline.\n• Within 2 seconds, B and C fill all 16 cells.\n• Status badge changes to 'Verified' on both screens!"),

    ("1:30 - 2:00 | Cryptographic Hash Match & Gemini Room Guide (Speakers: All)",
     "English Pitch:\n'We click \"Save verified file\" on both laptops and check the SHA-256 checksum: exactly fbbab289... matching the original bit-for-bit with ZERO internet used!\nFinally, look at our Gemini Room Guide. The instructor can select Sinhala or English and click \"Explain snapshot\". Google Gemini 3.8 Flash analyzes live peer counts and chunk coverage, giving the teacher a clear, grounded explanation in Sinhala of what is happening in the classroom!'\n\n"
     "Live Action on Screen:\n• Click Save on Laptop B and C.\n• Run Get-FileHash demo\\workshop.bin on terminal -> shows fbbab289...\n• In Room view, select 'Sinhala' and click 'Explain this snapshot' -> Gemini response renders live!")
]

for title, body in script_blocks:
    p_box = doc.add_paragraph()
    p_box.paragraph_format.space_before = Pt(6)
    p_box.paragraph_format.space_after = Pt(2)
    run_b_title = p_box.add_run("▸ " + title)
    run_b_title.font.bold = True
    run_b_title.font.name = "Segoe UI"
    run_b_title.font.size = Pt(10.5)
    run_b_title.font.color.rgb = RGBColor(16, 91, 73)

    p_body = doc.add_paragraph()
    p_body.paragraph_format.left_indent = Inches(0.2)
    p_body.paragraph_format.space_after = Pt(8)
    run_b_body = p_body.add_run(body)
    run_b_body.font.name = "Segoe UI"
    run_b_body.font.size = Pt(9)
    run_b_body.font.color.rgb = RGBColor(30, 41, 59)

# Section 3: Commands Runbook
h3 = doc.add_heading("3. Execution Runbook: Exact Laptop Commands", level=1)
h3.paragraph_format.space_before = Pt(12)
h3.paragraph_format.space_after = Pt(6)

cmd_data = [
    ("Laptop B (Coordinator & Receiver B)", 
     "Run Coordinator server (keep terminal open):\n.\\.venv\\Scripts\\python -m uvicorn server.main:app --host 0.0.0.0 --port 8765 --ws auto --ws-max-size 131072\n\nCheck IPv4 address:\nipconfig (e.g., note 192.168.8.105)"),
    ("Laptops A and C (Source A & Receiver C)",
     "Run lightweight Python forwarder to Laptop B's IP:\npython server/forward.py 192.168.8.105"),
    ("All Laptops (Chrome Browser)",
     "Open chrome://extensions -> Developer mode ON -> Load unpacked -> select extension/ folder.\nClick LabMesh icon -> Open room tab (ws://127.0.0.1:8765/ws)."),
    ("Test Asset Generation",
     "Generate 1 MiB workshop fixture on Laptop A:\npython demo/fixture.py\nVerify SHA-256: Get-FileHash demo\\workshop.bin\nDigest: fbbab289f7f94b25736c58be46a994c441fd02552cc6022352e3d86d2fab7c83")
]

for heading, cmd in cmd_data:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("• " + heading)
    r.font.bold = True
    r.font.name = "Segoe UI"
    r.font.size = Pt(9.5)

    p_code = doc.add_paragraph()
    p_code.paragraph_format.left_indent = Inches(0.2)
    p_code.paragraph_format.space_after = Pt(6)
    r_code = p_code.add_run(cmd)
    r_code.font.name = "Consolas"
    r_code.font.size = Pt(8.5)
    r_code.font.color.rgb = RGBColor(15, 23, 42)

# Section 4: Anticipated Q&A Defense
h4 = doc.add_heading("4. Anticipated Judges' Questions & Winning Answers (Q&A)", level=1)
h4.paragraph_format.space_before = Pt(12)
h4.paragraph_format.space_after = Pt(6)

qa_pairs = [
    ("Q1: How does WebRTC connect without public STUN/TURN servers?",
     "Answer: Since all workshop laptops are on the same local venue Wi-Fi or mobile hotspot, WebRTC ICE discovers local host candidates (LAN IP addresses). The FastAPI WebSocket server on Laptop B introduces the peers by relaying SDP and ICE messages. Once the data channel opens, traffic flows directly laptop-to-laptop over LAN without touching any public STUN/TURN server."),
    
    ("Q2: What happens if Laptop B (the coordinator) disconnects instead of Laptop A?",
     "Answer: In our architecture, the coordinator only negotiates the initial handshake. Once WebRTC RTCDataChannels are open between peers, the data channels are fully peer-to-peer and independent of the WebSocket coordinator! Furthermore, in a production classroom, we recommend running the coordinator on the teacher's smartboard or a dedicated low-cost Raspberry Pi."),
    
    ("Q3: How do you guarantee the file is not corrupted or tampered with?",
     "Answer: We use two-level cryptographic verification: First, the manifest contains individual SHA-256 hashes for every 8 KiB chunk. A received chunk is rejected immediately if its hash doesn't match. Second, before exposing the downloadable Blob, the entire file is re-hashed using Web Crypto API to guarantee bit-for-bit SHA-256 equality with the instructor's original file."),

    ("Q4: Why use Google Gemini API instead of hardcoded if/else alert messages?",
     "Answer: In a live classroom, teachers are educators, not network engineers. Raw chunk bitmasks, loss rates, and WebRTC states are incomprehensible to them. The Gemini Room Guide translates complex distributed state snapshots into concise, actionable instructions in Sinhala and English (e.g., 'Student C is missing 4 chunks, please keep Student B connected for 10 more seconds'). It bridges distributed tech and classroom pedagogy."),

    ("Q5: How does LabMesh differ from AirDrop or BitTorrent?",
     "Answer: AirDrop only works on Apple devices and requires 1-to-1 Bluetooth handshakes. BitTorrent requires external trackers, complex desktop torrent clients, and firewall configurations often blocked in schools. LabMesh is zero-install: it runs as a pure Chrome extension on any OS (Windows, Mac, Linux, Chromebook), needs zero cloud accounts, and operates completely offline on local Wi-Fi.")
]

for q, a in qa_pairs:
    pq = doc.add_paragraph()
    pq.paragraph_format.space_before = Pt(6)
    pq.paragraph_format.space_after = Pt(2)
    rq = pq.add_run(q)
    rq.font.bold = True
    rq.font.name = "Segoe UI"
    rq.font.size = Pt(9.5)
    rq.font.color.rgb = RGBColor(180, 83, 9) # Amber

    pa = doc.add_paragraph()
    pa.paragraph_format.left_indent = Inches(0.2)
    pa.paragraph_format.space_after = Pt(6)
    ra = pa.add_run(a)
    ra.font.name = "Segoe UI"
    ra.font.size = Pt(9)
    ra.font.color.rgb = RGBColor(51, 65, 85)

output_path = r"d:\jiat foss hack\labmesh\LabMesh_Presentation_Guide.docx"
doc.save(output_path)
print(f"Successfully generated: {output_path}")
