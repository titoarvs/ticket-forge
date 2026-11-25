# Plans and billing

Plans, limits and payment gateways on the hosted service. Back to the [documentation index](../README.md).

## Plans and billing (Stripe)

On the hosted service (`TICKETFORGE_MODE=saas`) each workspace has a plan. Self-hosted, and the service's own
`default` workspace, have no limits.

- **Plans** are in `lib/plans.ts`: Free, Pro and Team, with limits on projects, members (people plus pending
  invites), platform AI actions per month, AI code jobs per month and storage. The prices and limits there are
  placeholders. Every limit has a name, a numeric value (`null` = no limit) and a unit (`LIMIT_DEFS`, checked by
  `validatePlan` when the app loads). Every new workspace starts on Free; paid plans are started from Billing. A plan
  with `archived: true` is left out of the plans offered for purchase (Billing, Pricing, `GET /api/plans?purchasable=1`)
  and can't be checked out, but workspaces already on it keep it.
- **Every feature is on every plan** (TF-101): a plan limits how much you use, never which features you can use.
  Only a positive limit stops anything; a value of `0` (for example AI code jobs on Free) no longer means "not
  included" and is treated as no limit (`enforced()` in `lib/limits.ts`).
- **What counts as an AI action**: only calls that use the service's own AI keys (environment variables).
  Providers a workspace adds in Administration → AI, and people's own Claude subscriptions (My AI), don't count.
  Monthly allowances are taken atomically, so many requests at once never go over, and a failed call gives its
  allowance back.
- **Going over a limit** returns HTTP 402 `{ code: 'limit' }`, and the app shows an Upgrade prompt. Owners can go
  to the plans from there; others are asked to contact their owner. Nothing already there is removed: a workspace
  over its limit after a downgrade just can't add more.
- **Billing page**: Administration → Billing (workspace owner) shows the plan, what renews when, and usage against
  each limit. **Choose a plan** opens Stripe Checkout; **Manage billing** opens the Stripe Customer Portal (card,
  invoices, plan changes, cancelling).
- **Webhook**: `POST /api/stripe/webhook`. It checks the `Stripe-Signature` (HMAC, 5-minute window) and handles
  each event once (`billing_events`). It reads the subscription back from Stripe before changing the plan. Events:
  `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid` and
  `invoice.payment_failed`. A failed payment keeps the plan while Stripe retries (the Billing page warns); a
  cancelled or unpaid subscription returns the workspace to Free.
- **Setup**:
  1. In Stripe, create a product with monthly and yearly prices for Pro and Team.
  2. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTH`, `STRIPE_PRICE_PRO_YEAR`,
     `STRIPE_PRICE_TEAM_MONTH` and `STRIPE_PRICE_TEAM_YEAR`. Optionally set `PLAN_CURRENCY` (default USD).
  3. In Stripe, add a webhook endpoint `https://<your domain>/api/stripe/webhook` with the events above.
  4. Turn on the Customer Portal in Stripe's settings.
  To try it locally: `stripe listen --forward-to localhost:5173/api/stripe/webhook` with test keys, and the card
  4242 4242 4242 4242.
- **Payment method (PayMongo, PHP)**: `/checkout?plan=pro&interval=month` (owner only) lets the customer choose
  **Card**, **GCash** or **Maya**, shows the total in PHP, and **Pay** continues to `/checkout/<method>` (the payment
  step). Pressing Pay with no method asks the customer to choose one. Methods the gateway doesn't support are not
  shown: set `PAYMONGO_PAYMENT_METHODS` (comma list of `card`, `gcash`, `paymaya`; default all three). PHP prices are
  in `lib/payment-methods.ts`. API: `GET/POST /api/billing/payment-methods`.
- **PayMongo checkout**: with `PAYMONGO_SECRET_KEY` set, Billing shows **Start paid plan** on each paid plan (owner
  only; non-owners never see it, and the API refuses them with 403). It opens the checkout above; on the payment step,
  **Continue to PayMongo** creates a PayMongo Checkout Session in PHP (`POST /api/billing/paymongo`) and redirects to
  its page. PayMongo sends the owner back to `/checkout/return`, which reads the session back from PayMongo
  (`GET /api/billing/paymongo/return`) and shows one of: **success** (plan activated, new plan shown), **cancelled**
  (nothing is created, the plan stays as it was) or **failed** (error with a **Retry** button back to the checkout).
  A success is never taken from the address: the plan changes only when PayMongo reports the payment as paid. The
  pending session is kept in `workspaces.paymongo_checkout_id`. `PAYMONGO_API_BASE` points tests at a local mock.
- **Payment gateways and plans (TF-100)**: Administration → **Plans & gateways** (the owner who runs this TicketForge:
  the default workspace's owner or a `PLATFORM_ADMIN_EMAILS` account; hosted service only).
  - *Gateways*: **PayMongo** (PHP), **Xendit** (PHP) and **Stripe** (PHP, USD) can all be active at once. Enabling one
    needs its secret key, which is checked with the gateway first (a wrong key shows an error and the gateway stays
    inactive) and then stored encrypted in `payment_gateways`; it is never sent back to the browser.
    `PAYMONGO_API_BASE`, `XENDIT_API_BASE` and `STRIPE_API_BASE` point tests at a local mock.
  - *Plans* (`billing_plans`, `lib/billing-plans.ts`): name, price, currency (PHP or USD), cycle (monthly or yearly),
    free-plan option and trial days. The default Free, Pro and Team plans from `lib/plans.ts` are copied in the first
    time. Editing the price, currency, cycle, free option or trial days of a plan that has subscribers adds a **new
    version**; workspaces keep the version they subscribed to (`workspaces.plan_version`) and new subscriptions use the
    latest. Other edits change the latest version in place. API: `GET/POST /api/billing/plans`, `PUT /api/billing/plans/<id>`.
  - *Choosing a plan* (Billing): a plan with trial days starts a **trial with no card** (`POST /api/billing/subscription`)
    with full access until it ends. A trial that ends without a payment **locks the workspace**: every API route except
    sign-in and billing answers 402 `locked`, and the app shows a pay prompt until the owner pays at `/checkout` (plan
    and active gateway picked there; the way back reads the payment from the gateway, then the plan is `active`) or
    cancels. Switching plan during a trial keeps the trial; switching while paid is a new payment on the new plan (no
    proration yet) and cancelling keeps access until the paid period ends. Paying through PayMongo or Xendit is one
    payment per period: renewals are not charged automatically yet.
