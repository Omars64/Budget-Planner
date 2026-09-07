# Bank message forwarding

FlowBudget supports an authenticated message inbox for NBK, KFH, Gulf Bank and Commercial Bank of Kuwait (CBK). This is not a direct connection to a bank account. No bank credentials are collected.

## Setup

1. Sign in and open Bank messages. Create a forwarding key. It is displayed once.
2. On the phone, configure an automation restricted to the bank's transaction-alert sender. Exclude OTP, password, verification and login messages.
3. Send an HTTPS POST to `https://budget-planner-ecru-seven.vercel.app/api/bank-messages/forward`.
4. Add the `Content-Type: application/json` header and the `X-FlowBudget-Key` header containing the forwarding key.
5. Send this JSON body, substituting the bank, a stable message identifier, and the received text:

```json
{
  "bank": "NBK",
  "reference": "unique-device-message-id-or-stable-message-hash",
  "message": "The transaction alert text"
}
```

Allowed bank names are `NBK`, `KFH`, `Gulf Bank`, and `CBK`. Use the same reference when retrying delivery; different purchases need different references. Do not generate a new reference on each retry.

The inbox accepts up to 500 unreviewed messages per account. A forwarding key permits adding messages only. It cannot read wallets, change expenses, or sign in. Replacing or disabling the key immediately invalidates the old key. A phone number stored in Settings is contact information, not verified ownership or permission to read SMS.

## Devices

On iPhone, Apple Shortcuts provides a Message automation trigger. Configure a bank sender filter and an HTTPS request action with the body above. OS version and device settings affect unattended execution. This setup has not been tested on a physical iPhone.

On Android, an explicitly configured automation or an appropriately permissioned native app can send the same request. FlowBudget's website cannot read the SMS inbox. This setup has not been tested on a physical Android device. Evaluate the automation's permissions before granting access to messages.

Messages can also be pasted into Bank messages from either phone. Review the actual debit amount, date, description and wallet before selecting Record expense. No amount is inferred from a balance, OTP, or other number in a message. Repeated posting of the same inbox item cannot produce multiple expenses.

## Direct bank feeds

Live bank sync is not configured. Production account-feed access for the Kuwait operations of each bank and a customer-consent integration are required. Bahrain open-banking endpoints and corporate payment APIs are not substitutes for Kuwait retail transaction feeds.

## Reminders

Current daily reminders run while FlowBudget is open, using each device's local time. Browser notification permission is optional. Closed-app delivery requires Web Push subscriptions, a service worker, and a scheduled backend delivery service; those are not configured in this version.
