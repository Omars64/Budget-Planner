from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

OUT = Path('output/pdf/flowbudget-bank-messages-guide.pdf')
OUT.parent.mkdir(parents=True, exist_ok=True)
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleFB', parent=styles['Title'], alignment=TA_CENTER, textColor=colors.HexColor('#0a4173'), fontSize=24, leading=29, spaceAfter=8))
styles.add(ParagraphStyle(name='SubFB', parent=styles['Normal'], alignment=TA_CENTER, textColor=colors.HexColor('#536772'), fontSize=10, leading=14, spaceAfter=18))
styles.add(ParagraphStyle(name='HFB', parent=styles['Heading2'], textColor=colors.HexColor('#0a4173'), fontSize=15, leading=19, spaceBefore=10, spaceAfter=7))
styles.add(ParagraphStyle(name='BodyFB', parent=styles['BodyText'], fontSize=9.5, leading=14, spaceAfter=7))
styles.add(ParagraphStyle(name='SmallFB', parent=styles['BodyText'], fontSize=8, leading=11, textColor=colors.HexColor('#536772')))
styles.add(ParagraphStyle(name='CodeFB', parent=styles['BodyText'], fontName='Courier', fontSize=7.7, leading=11, backColor=colors.HexColor('#eef4f7'), borderPadding=7, spaceAfter=9))

def P(text, style='BodyFB'): return Paragraph(text, styles[style])
def bullets(items): return [P('&bull; ' + x) for x in items]
def footer(canvas, doc):
    canvas.saveState(); canvas.setFont('Helvetica', 8); canvas.setFillColor(colors.HexColor('#7b8b93'))
    canvas.drawString(18*mm, 12*mm, 'FlowBudget - Bank message setup guide')
    canvas.drawRightString(192*mm, 12*mm, f'Page {doc.page}'); canvas.restoreState()

story = [P('FlowBudget', 'TitleFB'), P('Bank message capture and review guide', 'SubFB'),
         P('What this feature does', 'HFB'), P('FlowBudget can receive a forwarded bank alert, keep it in your Bank messages inbox, and let you review the details before recording a single expense. Messages are deduplicated by reference, and OTP, password, verification, and login messages are rejected automatically.', 'BodyFB'),
         P('<b>Supported bank labels:</b> NBK, KFH, Gulf Bank, and CBK. Choose the matching label when pasting or forwarding a message.', 'BodyFB'),
         P('Before you begin', 'HFB'), *bullets(['Deploy FlowBudget over HTTPS. The forwarding endpoint must not be used over plain HTTP.', 'Open FlowBudget, go to Bank messages, and create a forwarding key. Copy it immediately; it is shown only once.', 'Never put your FlowBudget key, bank password, card PIN, or OTP in a note, screenshot, URL, or chat.', 'Messages first arrive as pending. Open Review expense and confirm the wallet, category, amount, date, and description before recording.']),
         P('The exact endpoint', 'HFB'), P('Your personal endpoint is:', 'BodyFB'), P('https://YOUR-FLOWBUDGET-DOMAIN/api/bank-messages/forward', 'CodeFB'), P('Send a JSON POST with the key in the header:', 'BodyFB'), P('X-FlowBudget-Key: YOUR_FORWARDING_KEY\nContent-Type: application/json\n\n{\n  "bank": "NBK",\n  "message": "YOUR_BANK_ALERT_TEXT",\n  "reference": "BANK_REFERENCE_OR_UNIQUE_ID"\n}', 'CodeFB'),
         P('Android setup', 'HFB'), P('Android does not provide a safe, universal browser API for silently reading every SMS. Use an automation app that has permission to read incoming SMS, then configure a narrow rule for bank sender IDs or phrases. Tasker, Automate, or a managed enterprise automation tool can make the HTTPS POST above.', 'BodyFB'),
         P('1. Install an automation app you trust and review its SMS, network, and accessibility permissions. 2. Create an incoming SMS trigger. 3. Restrict it to the sender IDs used by NBK, KFH, Gulf Bank, and CBK. 4. Add a second condition requiring a transaction phrase such as purchase, debit, credit, transfer, or KWD. 5. Exclude OTP, verification, login, password, and security phrases. 6. Build the JSON body and POST it to the endpoint with X-FlowBudget-Key. 7. Send one harmless test alert and confirm it appears as pending in FlowBudget.', 'BodyFB'),
         P('iPhone setup', 'HFB'), P('iPhone does not allow a web app to read all incoming SMS. Use Apple Shortcuts with an automation triggered by a message from a selected sender or containing a selected phrase. Apple may require confirmation depending on the automation and iOS version.', 'BodyFB'),
         P('1. Open Shortcuts, choose Automation, and create a Message automation. 2. Select the relevant bank sender or a transaction phrase. 3. Add Get Contents of URL. 4. Set the method to POST, use the FlowBudget endpoint, and add the X-FlowBudget-Key header. 5. Send a JSON request body containing bank, message, and a stable reference. 6. Add filters so OTP and security messages are never forwarded. 7. Run a test, then check Bank messages for a pending review item.', 'BodyFB'),
         P('Recommended sender filters', 'HFB'),
         Table([[P('<b>Bank</b>','SmallFB'), P('<b>Use</b>','SmallFB'), P('<b>Do not forward</b>','SmallFB')], [P('NBK','SmallFB'), P('Card purchase, debit, credit, transfer alerts','SmallFB'), P('OTP, login, verification','SmallFB')], [P('KFH','SmallFB'), P('Card purchase, debit, credit, transfer alerts','SmallFB'), P('Password or security code','SmallFB')], [P('Gulf Bank','SmallFB'), P('Card purchase, debit, credit, transfer alerts','SmallFB'), P('Authentication messages','SmallFB')], [P('CBK','SmallFB'), P('Card purchase, debit, credit, transfer alerts','SmallFB'), P('OTP or account security','SmallFB')]], colWidths=[32*mm, 78*mm, 75*mm])
         ,Spacer(1, 5*mm), P('Review and record safely', 'HFB'), *bullets(['Pending messages do not change your wallet balance.', 'Reviewing parses a suggested amount and date; always verify them against the alert.', 'Recording creates one expense and marks the message recorded. Repeating the same reference will not create another expense.', 'Delete only messages you intentionally no longer need. Deleting a pending message never deletes a transaction already recorded.']),
         PageBreak(), P('Troubleshooting', 'HFB'),
         P('<b>No message appears:</b> confirm the key is current, the URL is your deployed HTTPS URL, and the bank label is one of the supported values. Check that the automation actually ran and that its JSON body is valid.', 'BodyFB'),
         P('<b>Duplicate message:</b> use a stable bank reference. If the bank alert has no reference, generate a deterministic reference from the sender, timestamp, amount, and message text in your automation.', 'BodyFB'),
         P('<b>Message rejected:</b> the safety filter may have detected OTP, password, verification, login, or security wording. Do not bypass this filter. Paste only transaction alerts.', 'BodyFB'),
         P('<b>Wrong amount or date:</b> keep the item pending and correct the fields in Review expense before recording. The original bank text remains visible for comparison.', 'BodyFB'),
         P('Privacy and security', 'HFB'), *bullets(['Use a separate forwarding key per device or automation. Revoke and replace it immediately if exposed.', 'Keep the automation limited to bank senders and transaction phrases. Do not forward all personal messages.', 'FlowBudget stores the pending message for your account only. Authentication and ownership checks apply to every bank-message request.', 'Direct Kuwait bank API synchronization is a separate integration. It requires a regulated open-banking provider, bank coverage, consent, and production credentials; this guide covers message capture only.']),
         P('Quick checklist', 'HFB'), *bullets(['HTTPS deployment works', 'Forwarding key created and stored securely', 'Sender and phrase filters restricted', 'OTP and security messages excluded', 'One test message visible as pending', 'Wallet and category verified before recording']),
         Spacer(1, 8*mm), P('Keep this guide with your FlowBudget deployment notes. Settings and forwarding keys can be rotated at any time from the Bank messages screen.', 'SmallFB')]

doc = SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=16*mm, bottomMargin=20*mm, title='FlowBudget Bank Message Guide', author='FlowBudget')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
