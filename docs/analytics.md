# Public site analytics

The public site uses Vercel Web Analytics for aggregate page views. The
`<Analytics />` component is mounted only in `app/(public)/layout.tsx`; the
members-only `/portal` area is outside that route group and is not tracked.

## Custom events

Custom events are disabled unless the Vercel project sets
`NEXT_PUBLIC_ENABLE_ANALYTICS_EVENTS=true`. Leave it unset or `false` while the
project plan does not support custom events. Vercel builds this public value
into the client bundle, so changing it requires a redeploy. Page-view analytics
does not depend on this flag.

The current event names are:

| Event | When it fires | Properties |
| --- | --- | --- |
| `apply_click` | An application link on Join Us is clicked | `page: "join-us"` |
| `contact_submit` | A contact submission succeeds | None |
| `mailing_list_click` | The footer mailing-list link is clicked | `page: "footer"` |
| `instagram_click` | An Instagram link on Contact or in the footer is clicked | `page: "contact"` or `"footer"` |

No form fields, email addresses, names, or other personal data are sent with
these events. The helper in `lib/analytics.ts` is the only place that calls
Vercel's custom-event API. To add an event, extend its event/property types,
call `track()` at the successful action, and update this table.

## Viewing analytics

Enable Web Analytics in the Vercel project, deploy the site, then open the
project's **Analytics** tab. Page views appear there; custom events appear when
the project plan supports them and the environment flag is enabled.

For setup details, see [Vercel's Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart)
and [custom events guide](https://vercel.com/docs/analytics/custom-events).
