# Budgetly: OpenAI setup and billing

Updated 14 September 2026. Requested API project: **Budget-planner**.

## Who pays?

The OpenAI organization owning the configured API key pays for calls made by all Budgetly users. The project name in Vercel does not select an OpenAI billing account. Use a key created inside the OpenAI **Budget-planner** project. The actual organization and payment method must be checked in your OpenAI account; a project name alone does not verify them.

ChatGPT subscriptions and API usage are billed separately. Budgetly users do not need their own API keys. Vercel hosting charges, if any, are separate too.

## Where to look

| Purpose | Open this page | What to do |
| --- | --- | --- |
| Verify organization and project | [OpenAI projects](https://platform.openai.com/settings/organization/projects) | Select the intended organization, then Budget-planner. Confirm you are an owner or have the needed permissions. |
| Track requests and cost | [Usage](https://platform.openai.com/usage) | Filter by Budget-planner, model and date range. Usage reporting can lag slightly. |
| Payment method, credits and invoices | [Billing](https://platform.openai.com/settings/organization/billing/overview) | Check the organization's payment details, balance and billing history. Review automatic recharge settings if enabled. |
| Configure limits | [Project settings](https://platform.openai.com/settings/organization/projects) | Open Budget-planner, then Limits. Review model access, spending controls and alerts. |
| Manage API keys | [API keys](https://platform.openai.com/api-keys) | Select Budget-planner before creating, restricting or revoking its keys. |

Projects belong to organizations and can have their own keys, permissions and usage tracking. See [OpenAI project management](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects).

## Initial setup

1. Select your OpenAI organization and its Budget-planner project. Create a dedicated server API key; restrict it to the API permissions needed for Chat Completions. Do not use an organization administrator key.
2. In Vercel, open **budget-planner > Settings > Environment Variables**.
3. Add `OPENAI_API_KEY` as a secret for Production. Paste the project key privately. Never use a `VITE_` prefix or commit the key to GitHub; those could expose it in the browser or APK.
4. Add `OPENAI_MODEL` with value `gpt-4o-mini`. The code rejects a different model and has no alternative provider fallback.
5. Remove the previous provider configuration. Separately revoke any unused previous-provider key at its issuing service, especially one previously pasted into a chat.
6. Deploy the updated code. Environment changes apply to new deployments, not running older ones. Retained old deployments can still contain old configuration; protect or remove any externally accessible retired deployment when appropriate.
7. In Budgetly, open **Admin > Ask Budgetly**. Refresh the configuration status. Enable AI only after confirming the intended billing project and limits. Enabling requires administrator access and password confirmation.
8. Ask a short budgeting question, then check OpenAI Usage for Budget-planner. This is a billable verification request. A key's mere presence in Vercel does not prove it is valid or tied to the intended project.

## Pricing

At the checked pricing, GPT-4o mini costs **USD 0.15 per million input tokens** and **USD 0.60 per million output tokens**; eligible cached input is USD 0.075 per million. Input includes Budgetly's instructions, selected records and recent conversation context, not just the sentence typed by a user. [Official model pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini)

For illustration, 2,000 input tokens and 500 output tokens cost about **USD 0.0006**. A thousand requests of that exact size would cost about **USD 0.60**, before any applicable taxes or currency conversion. Actual requests vary; this is not a monthly price guarantee.

## Control spending

- Set a monthly amount you are comfortable with in **Budget-planner > Limits > Spend > Edit spend limit**. Turn on **Enforce a hard limit** if you want requests stopped at that amount.
- Alerts alone do not stop requests. Add alerts below your limit so you can investigate early.
- Enforcement is not instantaneous; a small overshoot can occur while tracked spend propagates. Organization-wide limits can also affect this project. [Official spend-limit behavior and configuration](https://developers.openai.com/api/docs/guides/spend-limits)
- Budgetly keeps the existing server-wide ceiling of 50 AI attempts per day and 15 per minute, plus a maximum 1,800 output tokens per response. These request limits are not an exact dollar cap. Failed attempts may also consume Budgetly's request allowance.
- There are no automatic model retries, browsing tools, model upgrades, or alternate providers in this integration.
- For an immediate app-level stop, disable **Admin > Ask Budgetly > Enable AI for all users**. New requests use built-in guidance. Requests already sent may finish and be billed.
- To stop all use of a key, revoke it in OpenAI. This also affects any other deployment using that key. Rotate keys if exposed, update Vercel, and redeploy.

## What gets sent, and when?

With AI enabled and a valid configuration, a submitted question sends the question, recent chat context, a Budgetly feature guide, and activity for the selected authorized scope to OpenAI. General scope omits personal financial records. API credentials stay on the server. OpenAI response storage is explicitly disabled in the request; this is not a claim of zero provider retention under every account policy.

Opening a page, viewing history or running the tutorial does not call OpenAI. Without the key, with AI disabled, or when a provider request fails, Budgetly falls back to built-in guidance. It does not silently switch to another paid service.

## Common problems

- **Key not configured:** ensure the variable is named exactly `OPENAI_API_KEY`, scoped to the deployment you use, and deployed after it was added.
- **Other model blocked:** set `OPENAI_MODEL=gpt-4o-mini`, then redeploy.
- **No usage after a question:** check the admin toggle, configuration status and whether the answer reports a fallback. Confirm you are viewing the correct organization/project and date range in OpenAI.
- **Built-in fallback despite a key:** the key may be invalid, lack permission, have insufficient credit, or have hit a limit. Check OpenAI Usage and billing; Budgetly deliberately does not expose secret provider error bodies to users.
- **Unexpected usage:** disable AI, inspect usage by project/key, revoke a suspect key, and check old deployments or other services using the same key.

No billing account, payment method or spend limit is changed by the code patches themselves.
