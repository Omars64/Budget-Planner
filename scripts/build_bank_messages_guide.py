"""Build the beginner guide and the identical download served by FlowBudget."""
from pathlib import Path
from shutil import copyfile
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/flowbudget-bank-messages-guide.pdf'
PUBLIC = ROOT / 'public/flowbudget-bank-messages-guide.pdf'
SITE = 'https://budget-planner-ecru-seven.vercel.app'
ENDPOINT = SITE + '/api/bank-messages/forward'
INK = colors.HexColor('#18333f')
TEAL = colors.HexColor('#147568')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleFB', fontName='Helvetica-Bold', fontSize=26, leading=31, textColor=INK, spaceAfter=14))
styles.add(ParagraphStyle(name='HFB', fontName='Helvetica-Bold', fontSize=14, leading=19, textColor=TEAL, spaceBefore=12, spaceAfter=8))
styles.add(ParagraphStyle(name='BodyFB', fontName='Helvetica', fontSize=10.5, leading=15.5, textColor=INK, spaceAfter=9))
styles.add(ParagraphStyle(name='SmallFB', parent=styles['BodyFB'], fontSize=9, leading=13, textColor=colors.HexColor('#526771')))
styles.add(ParagraphStyle(name='CodeFB', fontName='Courier', fontSize=9, leading=13, textColor=INK, backColor=colors.HexColor('#edf5f3'), borderPadding=9, spaceBefore=8, spaceAfter=13))

def p(text, style='BodyFB'):
    return Paragraph(text, styles[style])

def step(number, text):
    return p(f'<b>{number}.</b> {text}')

def code(text):
    return p(escape(text).replace('\n', '<br/>'), 'CodeFB')

def note(text):
    box = Table([[p(text)]], colWidths=[174*mm])
    box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#eef5f4')),('BOX',(0,0),(-1,-1),.5,colors.HexColor('#cbded8')),('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
    return box

def fields(rows):
    table = Table([[p(a,'SmallFB'),p(b,'SmallFB')] for a,b in rows], colWidths=[54*mm,120*mm], hAlign='LEFT')
    table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('ROWBACKGROUNDS',(0,0),(-1,-1),[colors.HexColor('#f0f5f6'),colors.white]),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
    return table

story=[]
def page(number, part, title, *content):
    if story: story.append(PageBreak())
    story.extend([p(f'<a name="p{number}"/>{part.upper()} | BEGINNER GUIDE', 'SmallFB'),p(title,'TitleFB'),*content])

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#d7e1e4'))
    canvas.line(18*mm,18*mm,192*mm,18*mm)
    canvas.setFont('Helvetica',8)
    canvas.setFillColor(colors.HexColor('#526771'))
    canvas.drawString(18*mm,12*mm,'FlowBudget | Bank messages | September 2026')
    canvas.drawRightString(192*mm,12*mm,f'{doc.page} / 13')
    canvas.restoreState()

page(1,'Start here','Your bank messages,\none small step at a time',
    Image(str(ROOT/'public/flowbudget-logo.png'),width=24*mm,height=24*mm,hAlign='LEFT'),Spacer(1,5*mm),
    p('Preface','HFB'),
    p('This guide is for everyday phone users. You do not need to know programming. Start with your phone chapter and follow one numbered step at a time. You can stop after the easy method and still use Bank messages fully.'),
    p('A bank alert is the text your bank sends after a purchase. FlowBudget stores a copy for you to review. It does not connect to your bank, move money, or fill in the expense amount automatically.'),
    note('<b>Our recommendation:</b> begin with copy and paste. It needs no extra app or forwarding key. Optional forwarding takes longer to set up and may need help from someone comfortable with phone settings.'),
    p('Choose your route','HFB'),
    fields([('<b>Everyone</b>','<link href="#p2" color="#147568">Page 2: words, buttons and your forwarding key</link>'),('<b>Android only</b>','<link href="#p3" color="#147568">Pages 3-7: easy method, apps and optional forwarding</link>'),('<b>iPhone only</b>','<link href="#p8" color="#147568">Pages 8-11: easy method and Apple Shortcuts</link>'),('<b>Help for both</b>','<link href="#p12" color="#147568">Pages 12-13: troubleshooting, stopping and sources</link>')]),
    p('Menus can differ by phone, language and app version. The forwarding instructions follow developer documentation; they have not been tested on every phone or Kuwait bank sender. No extra app is guaranteed to be accepted by every bank app.','SmallFB'))

page(2,'Before you start','A few useful basics',
    p(f'Open FlowBudget in your browser: <link href="{SITE}" color="#147568">{SITE}</link>'),
    p('Sign in. On a phone, tap the menu button (three horizontal lines), then <b>Bank messages</b>. Scroll down if you do not see it. On a computer, use the left menu.'),
    fields([('Tap / press and hold','Tap once to open something. Press and hold your finger down to reveal options such as Copy.'),('Copy / paste','Copy temporarily remembers text. Press and hold inside an empty box, then tap Paste to place it there.'),('Pending review','A message has arrived, but no expense has been created and no wallet balance has changed.'),('Wallet','The place in FlowBudget where you track money, for example Main wallet. It is not a bank connection.'),('Forwarding key','A private pass for an automation app to add messages to your account. It is not your password or a bank code.'),('Address / URL','The destination to which the helper app sends the message.'),('Automation / flow','A saved set of phone instructions that runs when something happens.')]),
    p('Only for optional forwarding: create your key','HFB'),
    step(1,'In Bank messages, find <b>Phone forwarding</b>. Tap <b>Create forwarding key</b>.'),
    step(2,'Press and hold the long key, choose <b>Select all</b>, then <b>Copy</b>. Paste it into the helper app when instructed. It is displayed only at creation; use a trusted password manager if you need to keep it.'),
    step(3,'If you lose it, use <b>Replace key</b>. There is <b>one current key per account</b>; replacing it means updating every helper using that account.'),
    note('Do not share the key in a screenshot, chat or shared shortcut. A key can add messages but cannot read your account. Copy the destination address before copying your key, so you do not accidentally overwrite the key on the clipboard.'))

page(3,'Android | Easy method','Copy, paste and review',
    p('<b>Use this first.</b> No extra app, SMS permission or setup code is needed. Keep this page open and switch between your Messages app and browser using Android\'s recent-apps screen.'),
    step(1,'Open the Messages app you normally use for bank texts. Open an ordinary purchase alert, not a login or verification message.'),
    step(2,'Press and hold the message. Tap <b>Copy</b>; it may be inside a three-dot menu. Select only the transaction alert.'),
    step(3,'Switch to FlowBudget. Open <b>Bank messages</b> and tap <b>Add message</b>.'),
    step(4,'Tap <b>Bank</b> and choose NBK, KFH, Gulf Bank or CBK. CBK means Commercial Bank of Kuwait.'),
    step(5,'Press and hold inside <b>Transaction message</b>, tap <b>Paste</b>, then tap <b>Add for review</b> once.'),
    note('<b>Success looks like:</b> "Message added for review" and a new item under Pending review. If it is missing, tap Refresh. Your wallet is unchanged at this point.'),
    p('Turn the message into an expense','HFB'),
    step(6,'Tap <b>Review expense</b>. Read the original alert displayed above the form.'),
    step(7,'Type the <b>Amount</b> and <b>Description</b>. Set the transaction date and time from the alert, and choose the correct <b>Wallet</b>. These fields are not automatically extracted. There is no category picker in this review form.'),
    step(8,'Tap <b>Record expense</b> once and wait. The item leaves Pending review; find the expense in <b>Transactions</b>. The selected wallet now reflects it.'),
    p('<b>Only spending:</b> do not use Review expense for salary, refunds, income or transfers between your own wallets. Add those with the appropriate type in Transactions. You can stop here; forwarding is optional.'))

page(4,'Android | Optional forwarding','Which app should I use?',
    fields([('<b>Automate by LlamaLab</b>','The detailed route on pages 4-7. It offers SMS triggers, custom headers and message formatting. Get it through <link href="https://llamalab.com/automate/" color="#147568">the developer\'s Google Play link</link>.'),('<b>Tasker</b>','An alternative for experienced users; it supports SMS events and HTTP requests. This guide does not give a Tasker recipe. Use <link href="https://tasker.joaoapps.com/" color="#147568">the developer\'s site</link>.'),('<b>Other SMS forwarders</b>','Not automatically compatible. An app must send all three fields on page 6 and a custom X-FlowBudget-Key header. Merely offering "webhooks" is not enough.')]),
    note('<b>If your bank app already reports unusual behavior:</b> stay with page 3. An external SMS automation app needs SMS access and can also trigger bank security checks. Do not turn off Play Protect or enable accessibility, screen recording, notification access or "appear on top" for this setup.'),
    p('Install and make one rule','HFB'),
    step(1,'Use the developer link above. Check the app name and developer before installing; review the displayed price and privacy details. Do not install an APK sent in a chat.'),
    step(2,'Open Automate. A <b>flow</b> is a diagram of instructions. Create a new flow with the plus button, open its editor, and name it <b>FlowBudget - NBK</b>. Start with just one bank.'),
    step(3,'The starting block is <b>Flow beginning</b>. Use the add-block button and search by the exact names used on the next pages. Tap a block to edit it, then save it.'),
    step(4,'Some boxes have an <b>fx</b> button. It switches from ordinary text to a formula. Use it only where this guide says "formula mode". Copy the supplied formula; you do not need to write your own.'),
    p('Automate may ask for SMS permission when the flow starts. Allow it only if you accept this optional method. Keep unrelated permissions off. If the app requires a separate permission workaround, stop and use page 3.','SmallFB'))

page(5,'Android | Optional forwarding','Choose messages and filter them',
    p('Add an SMS received block','HFB'),
    step(1,'In the editor, add <b>SMS received</b>. In its input <b>Phone number</b>, enter the exact sender from your bank text, including letters if the bank uses a name. Do not leave this blank.'),
    step(2,'Under <b>Output variables</b>, enter the following names exactly. These are labels the next blocks use, not your private details.'),
    fields([('Phone number','sender'),('Message','message'),('Timestamp sent','sent')]),
    p('This trigger receives ordinary SMS only, not WhatsApp, RCS, bank push notifications or old messages already in your inbox. If the sender does not match, use manual entry instead of widening it to every sender. [A1]','SmallFB'),
    p('Add an Expression true block','HFB'),
    step(3,'Add <b>Expression true</b>. In Expression, use formula mode and paste this English-alert filter:'),
    code('matches(message, "(?is).*(purchase|debited).*KWD.*") != null\n&& matches(message,\n  "(?is).*(otp|verification|password|passcode|login|"\n  ++ "security|one.time|code).*") = null'),
    p('This intentionally accepts only a narrow English pattern: purchase or debited, followed later by KWD, and no listed security words. An ordinary alert with different wording can be skipped. Arabic or mixed-language alerts should use manual entry until a helper has checked an appropriate filter. No word filter recognizes every security message.'),
    p('Add a Dialog confirm block','HFB'),
    step(4,'Set Title to <b>Send transaction alert to FlowBudget?</b> Set Message to <b>message</b> in formula mode. Keep <b>Show window off</b>; do not grant appear-on-top permission. This uses an ordinary notification you tap to review the text. [A3]'),
    note('Confirm only genuine expense alerts. Cancel login, PIN, OTP and unrelated messages. This beginner route asks before sending; it is not unattended SMS collection.'))

page(6,'Android | Optional forwarding','Tell Automate where to send it',
    p('Add <b>HTTP request</b>. This means "send this item to a website". Fill these settings; leave the others at their defaults. [A2]'),
    fields([('Request URL',f'<link href="{ENDPOINT}" color="#147568">{ENDPOINT}</link>'),('Request method','POST'),('Request content type','application/json'),('Timeout','30 seconds'),('Certificate','Keep normal secure certificate checking. Do not trust insecure or self-signed certificates.'),('Response status code','Enter <b>status</b> under Output variables.')]),
    p('Request headers: use formula mode','HFB'),
    code('{"X-FlowBudget-Key": "PASTE_YOUR_KEY_HERE"}'),
    p('Replace only PASTE_YOUR_KEY_HERE with the key from page 2. Keep the quotation marks and braces. Do not put the key into the website address or use your login password.'),
    p('Request content body: use formula mode','HFB'),
    code('jsonEncode({\n  "bank": "NBK",\n  "message": message,\n  "reference": sha256("NBK:" ++ sender ++ ":"\n    ++ sent ++ ":" ++ message)\n})'),
    p('Paste the whole box. The formula packages the alert and gives it a repeat-check label. It also handles quotation marks and line breaks in messages. For another bank, change both NBK entries to exactly <b>KFH</b>, <b>Gulf Bank</b> or <b>CBK</b>. [A4]'),
    p('The key and message are sent to FlowBudget over HTTPS. You do not need to know what JSON means beyond selecting this format and copying the supplied text.'))

page(7,'Android | Optional forwarding','Connect, test and stop',
    p('Connect the blocks','HFB'),
    p('Drag each small output dot onto the next block\'s IN dot. These are the complete connections for this beginner flow. [A5]'),
    fields([('Flow beginning: OK','SMS received: IN'),('SMS received: OK','Expression true: IN'),('Expression true: YES','Dialog confirm: IN'),('Expression true: NO','SMS received: IN'),('Dialog confirm: YES','HTTP request: IN'),('Dialog confirm: NO','SMS received: IN'),('HTTP request: OK','SMS received: IN')]),
    step(1,'Save. Return to the flow screen and tap <b>Start</b> once. Grant only the permissions needed for this flow, such as SMS and ordinary notifications. Avoid starting several copies.'),
    step(2,'For a harmless test, temporarily set the SMS sender to a trusted person\'s phone number. Ask them to send an ordinary SMS: <b>TEST purchase KWD 1.000 at Example Shop</b>. It must be SMS, not a chat message.'),
    step(3,'Tap the Automate notification, read the sample, and confirm. In FlowBudget, tap <b>Refresh</b>. The test should appear as pending. Delete the test with its bin button; <b>do not record it as an expense</b>.'),
    step(4,'Stop the flow, restore your bank\'s exact sender, save, and start it once. Check both FlowBudget and your bank app before relying on it.'),
    note('<b>This simple flow is not a guaranteed delivery service.</b> It can miss new messages while waiting for confirmation, stop after a network error, or be limited by battery settings. Check its log and your bank texts regularly; paste any missed alert manually. A returned status of 201 means accepted.'),
    p('<b>To stop:</b> open this flow in Automate and tap Stop. Then disable forwarding in FlowBudget (page 13). For another bank, duplicate the stopped flow and update its sender and both bank labels.'))

page(8,'iPhone | Easy method','Start with copy and paste',
    p('<b>This chapter is only for iPhone.</b> You do not need an Android app or a forwarding key for the easy method.'),
    step(1,'Open <b>Messages</b> and find an ordinary card-purchase text from your bank.'),
    step(2,'Press and hold the message bubble, then tap <b>Copy</b>. Do not copy verification or login messages.'),
    step(3,'Switch to your browser and open FlowBudget. Sign in, open the menu, choose <b>Bank messages</b>, and tap <b>Add message</b>.'),
    step(4,'Select the bank. Press and hold inside <b>Transaction message</b> and tap <b>Paste</b>. If iPhone asks whether to allow pasting, allow it for this action.'),
    step(5,'Tap <b>Add for review</b> once. Look under Pending review; tap Refresh if needed.'),
    step(6,'Tap <b>Review expense</b>. Enter the amount and description yourself. Correct the date/time and choose a wallet, then tap <b>Record expense</b>. It appears in Transactions, not Pending review.'),
    note('The date initially shown is the current date/time. Change it for an older alert. FlowBudget does not automatically extract the amount, date or merchant. Only one-time expenses can be recorded here.'),
    p('Which iPhone app can help?','HFB'),
    p('<b>Shortcuts by Apple</b> is the option described next. It is often already installed: swipe down on the Home Screen and search for Shortcuts. If missing, find it in the App Store and check that the developer is Apple.'),
    p('A third-party app calling itself an SMS forwarder does not gain unrestricted access to your iPhone inbox. Some still require Apple Shortcuts and do not send FlowBudget\'s required fields. You do not need to buy one for this guide.'),
    p('Stay with this page if you want the fewest settings. Pages 9-10 create a shortcut you run yourself; page 11 adds an optional incoming-message trigger.'))

page(9,'iPhone | Optional Shortcuts','Build a one-tap sending helper',
    p('Set aside time for the first setup. It uses normal action cards and text fields. A blue <b>variable</b> is a selectable result from an earlier card; do not type the variable\'s name as ordinary text.'),
    step(1,'Create a forwarding key in FlowBudget using page 2. Keep it private. Then open <b>Shortcuts</b>, choose the Shortcuts tab and tap <b>+</b> to create a shortcut. Name it <b>FlowBudget - NBK</b>.'),
    step(2,'Search the action list for <b>Ask for Input</b> and add it. Choose <b>Text</b> as the input type. Set the prompt to <b>Paste a spending alert only - no login or security codes</b>. [I1]'),
    step(3,'Add <b>Current Date</b>, then <b>Format Date</b>. Make sure Format Date uses the Current Date result. Set its format to <b>Custom</b> and enter <b>yyyyMMddHHmmssSSS</b>. This is a label for this send, not the date of the expense. [I2]'),
    step(4,'Add a <b>URL</b> action. Paste this full destination, beginning with https and ending with forward:'),
    code(ENDPOINT),
    step(5,'Add <b>Get Contents of URL</b> after it. Make sure its URL input is the URL card above. Expand the card using its arrow or <b>Show More</b>. Change Method to <b>POST</b>. [I3]'),
    note('<b>Selecting a result:</b> tap or press and hold the value box, choose Select Variable if shown, then tap the earlier action\'s result. The message must come from Ask for Input. It must not come from Current Date or URL.'),
    p('Leave this editor open and continue on page 10. If the action names differ, search using the English names above or use Shortcuts\' built-in help for your phone language.'))

page(10,'iPhone | Optional Shortcuts','Fill the fields and try it once',
    p('Inside Get Contents of URL','HFB'),
    step(6,'Expand <b>Headers</b> and add a row. Set its name to <b>X-FlowBudget-Key</b>. Paste your key as the value; do not add quotation marks or the word Bearer.'),
    step(7,'Select <b>JSON</b> for Request Body. Add the three rows below. Each row\'s type is <b>Text</b>. These are ordinary form rows; do not paste a block of programming code. [I3]'),
    fields([('<b>Key / name</b>','<b>Value</b>'),('bank','Type <b>NBK</b>. For another bank type exactly KFH, Gulf Bank or CBK.'),('message','Select the result from <b>Ask for Input</b> on page 9. Do not type "Ask for Input" literally.'),('reference','Select the result from <b>Format Date</b> on page 9. Do not select Current Date instead.')]),
    step(8,'Add <b>Show Result</b> after the request. Select the result of Get Contents of URL. Save the shortcut. [I4]'),
    p('Harmless first test','HFB'),
    step(9,'Run the shortcut with its play button. Enter <b>TEST purchase KWD 1.000 at Example Shop</b> when asked. If iPhone asks for permission to connect, check the domain is budget-planner-ecru-seven.vercel.app before allowing.'),
    step(10,'A successful response contains <b>id</b> and a number. Open Bank messages and tap Refresh. Delete the test from Pending review; do not record it as an expense.'),
    note('<b>For daily use:</b> copy an actual spending alert, run this shortcut, and paste it into the prompt. Then review the expense in FlowBudget. This shortcut gives every run a new reference: running it twice for the same alert can create two pending items. Compare them before recording.'),
    p('If you see an error, use page 12. Do not assume "shortcut finished" means FlowBudget accepted the message.'))

page(11,'iPhone | Optional automation','Run when a bank SMS arrives',
    p('Only continue after the manual shortcut test succeeds. Message automations depend on iOS and whether your bank\'s sender can be selected. They do not scan old messages or bank-app push notifications. [I5]'),
    step(1,'Duplicate your working shortcut and name it <b>FlowBudget - NBK incoming</b>. Keep the original for manual use. In the duplicate, replace Ask for Input with <b>Get Text from Input</b> and select <b>Shortcut Input</b> as its input.'),
    step(2,'In the request\'s <b>message</b> row, replace the old Ask for Input result with the result from Get Text from Input. Keep the date, URL, key and other rows as before.'),
    step(3,'Go to <b>Automation</b> in Shortcuts. Tap <b>+</b> or New Automation, then choose <b>Message</b>. Select your bank\'s sender. In <b>Message Contains</b>, enter a narrow purchase phrase used by that bank. Both conditions must match.'),
    step(4,'Choose <b>Run After Confirmation</b> for this beginner setup. Tap Next and select the incoming shortcut, or add <b>Run Shortcut</b> and choose it. If its input is not connected, expand the action and select the incoming message/Shortcut Input as the input.'),
    step(5,'Test first with a trusted person\'s sender and an ordinary SMS containing your chosen purchase phrase. Read the received message before approving the automation. Reject anything containing a code, login request, PIN, password or unrelated content.'),
    step(6,'Check the actual text arrived in Pending review, then delete the test. If only a sender or blank text arrives, the input mapping is wrong. Restore the working manual shortcut instead of forwarding further messages.'),
    step(7,'Restore the actual bank sender after the test. Repeat setup separately for another bank, changing the bank label in its shortcut too.'),
    note('Some iOS versions offer Run Immediately or Ask Before Running. Automatic running is supported for Message triggers on current iOS, but this guide keeps approval on because it does not implement a complete OTP/security filter. If your sender cannot be selected, do not use Any Sender; use page 8 or the manual shortcut. [I6]'))

page(12,'Help | Both phone types','When something does not work',
    fields([('<b>What you see</b>','<b>What to do next</b>'),('No item in FlowBudget','Check internet access. Open Bank messages and tap Refresh. Confirm you are signed into the same account that created the key. Check that the helper actually ran.'),('401 / invalid key','Replace the key in FlowBudget and update every helper using it. Paste it into X-FlowBudget-Key, not into the address.'),('422 / message rejected','Do not retry a security message. For a genuine spending alert, check bank spelling, all three fields, and that the text is under 2,000 characters. The reference must be nonempty and no longer than 160 characters.'),('429 / too many messages','The account has reached the pending-message limit (500). Review or deliberately remove old pending items first.'),('500, 503 or could not connect','Wait and check FlowBudget in your browser. Before resending, check whether the message already arrived. Use the original bank text to add a missing item later.'),('Wrong amount or old date','The review form requires manual entry. Correct it before recording. An already recorded expense must be changed in Transactions.'),('A duplicate appears','Do not record both. Delete the extra pending item after comparing the message, time and amount. iPhone helper retries can have different references.'),('Android helper stopped','Inspect the flow log for a connection error. Start it once after the cause is fixed. This simple flow has no guaranteed offline queue; compare against the original SMS and paste missing alerts.'),('iPhone sender unavailable','Use the manual shortcut or copy/paste. Do not broaden forwarding to all of your messages.'),('Bank app shows a warning','Stop the forwarding helper. Use FlowBudget in the browser with password-only sign-in. Record the warning and contact the bank if needed; do not disable bank protection or Play Protect.')]),
    p('When asking for help, share the phone model, Android/iOS version, helper app name, failed step number and error wording. Hide your key, balances, account numbers and all security codes.'))

page(13,'Help | Both phone types','Pause, protect and get help',
    p('Turn forwarding off','HFB'),
    step(1,'Android: stop the FlowBudget flow in Automate. iPhone: open Shortcuts, tap Automation, select the rule and disable it (Enable This Automation off or Don\'t Run, depending on version). [I6]'),
    step(2,'In FlowBudget, open Bank messages, find Phone forwarding and tap <b>Disable forwarding</b>. Confirm. Saved messages and recorded expenses remain; future submissions using that key are rejected.'),
    step(3,'If you shared your key accidentally, disable it immediately. Create a new one only when ready to update your helper. Never export or share a shortcut/flow that still contains a live key.'),
    p('Know the limits','HFB'),
    p('FlowBudget\'s own direct SMS capture is disabled. External helpers are optional and independently permissioned. A forwarding key is not a bank login; it cannot move money or read your data. The security-word filter is limited, so you must exclude security messages before sending them.'),
    p('Developer references | checked 8 September 2026','HFB'),
    p('[A1] <link href="https://llamalab.com/automate/doc/block/sms_received.html">Automate: SMS received</link> | [A2] <link href="https://llamalab.com/automate/doc/block/http_request.html">HTTP request</link> | [A3] <link href="https://llamalab.com/automate/doc/block/dialog_confirm.html">Dialog confirm</link><br/>[A4] <link href="https://llamalab.com/automate/doc/function/json_encode.html">JSON encoding</link>, <link href="https://llamalab.com/automate/doc/function/sha256.html">SHA-256</link>, <link href="https://llamalab.com/automate/doc/function/matches.html">message filters</link> | [A5] <link href="https://llamalab.com/automate/doc/flow.html">Flow editor</link>','SmallFB'),
    p('[I1] <link href="https://support.apple.com/guide/shortcuts/use-the-ask-for-input-action-apd68b5c9161/ios">Apple: Ask for Input</link> | [I2] <link href="https://support.apple.com/guide/shortcuts/custom-date-formats-apd8d9b19184/ios">Custom dates</link><br/>[I3] <link href="https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios">Get Contents of URL</link> | [I4] <link href="https://support.apple.com/guide/shortcuts/test-your-actions-apda75604f37/ios">Testing actions</link><br/>[I5] <link href="https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios">Message triggers</link> | [I6] <link href="https://support.apple.com/guide/shortcuts/enable-or-disable-a-personal-automation-apd602971e63/ios">Automation controls</link>','SmallFB'),
    p('App availability, screens and payment terms can change. Developer instructions confirm capabilities, not a physical-device compatibility certification. These are independent apps, not FlowBudget partners.','SmallFB'),
    note('<b>Your easiest fallback is always available:</b> copy a genuine expense alert, paste it into Bank messages, and review it before recording.'))

if __name__ == '__main__':
    OUT.parent.mkdir(parents=True,exist_ok=True)
    doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=18*mm,leftMargin=18*mm,topMargin=16*mm,bottomMargin=24*mm,title='FlowBudget - Bank Messages for Beginners',author='FlowBudget')
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    copyfile(OUT,PUBLIC)
    print(OUT)
    print('Updated in-app download:', PUBLIC)
