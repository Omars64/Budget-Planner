# Budgetly UI streamlining and GTA 6 theme

These proposals are for review before implementation. The approved Budgetly layout, navigation, and component placement are the baseline.

## UI review notes

| Screen | Proposed change |
| --- | --- |
| Bank Inbox | Show merchant, amount, destination wallet, and **Review**. Group **Ignore** and **Change destination** under **More options**. Keep possible duplicates and required corrections visible. |
| Transactions | Merge refresh status, last updated time, and **Retry** into one banner. Keep search and filters in their current positions. |
| Upcoming | Use **Plan only** and **Record automatically** consistently. Put timing and reminder rules behind an info button. Show **Records in Budgetly only** beside the automatic option. |
| Workbooks | Summarize the number of sheets and formulas needing review. Offer **Review formulas**. Show what the copy omits before import and put copy storage and formula behavior behind an info button. |
| Debt Management | Keep the amount and next due date prominent. Use **Paid on** or **Received on** for the actual date and **Applies to** for the instalment month. Put the distinction behind an info button. Preview the redistribution before saving an extra payment. |
| Settings and More | Remove repeated subtitles. Keep short descriptions where they distinguish tools. |
| Notifications | Prefer useful counts such as **2 to review** and **1 unread**. |

Use the existing info button for reference material. Keep required actions, errors, financial or data changes, and confirmation consequences visible at the point of decision.

## GTA 6 theme

- **Deep Plum** `#22152D` for surfaces, palm silhouettes, and the wallet icon background.
- **Flamingo Pink** `#E981B1` for selected states and the wallet icon's accent.
- **Sunset Peach** `#FFBB8C` for primary actions, the featured balance card, and the wallet body.
- Use an original Miami waterfront sunset behind the app chrome, with dark palm silhouettes and a readable foreground. Preview it at phone and desktop widths with wallpaper on and off.
- Keep the existing smooth matte wallet silhouette, with two cards and a single dark icon tile. Review Android, Windows, and favicon sizes.
- Demonstrate the current device palette preference and the independent **Match icon to color palette** setting. Review companion theme and launcher changes before they ship.
