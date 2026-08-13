# AI Ads Read API

AutoArk exposes a read-only machine endpoint for the AI product advertising
scope owned by the `gaoyuhua` organization.

## Authentication

Configure these server-side values:

```dotenv
AI_ADS_INTEGRATION_API_KEY=
AI_ADS_INTEGRATION_ORGANIZATION_ID=
```

Send the API key as a Bearer token. The organization scope is always taken from
server configuration; callers cannot override the organization, user, or
account list.

## Request

```http
GET /api/integrations/ai-ads?dimension=overview&startDate=2026-07-31&endDate=2026-07-31
Authorization: Bearer <api-key>
```

Supported dimensions:

- `overview`
- `account`
- `campaign`
- `country`
- `delivery` — daily spend grouped by parsed campaign delivery dimensions

`delivery` is the stable contract for ROI consumers. AutoArk owns campaign-name
parsing using this versioned convention:

```text
<optimizer>_<channel>_<product>_<platform>_*
```

For example, `gyh_fb_clingai_web_launch_01` is returned as optimizer `gyh`,
channel `facebook_ads`, product `clingai`, and platform `web`. Supported aliases
currently include `fb|facebook|meta`, `gg|google`, `tt|tiktok`, `kwai`, and
`web|android|apk|ios`. Names that do not satisfy the contract are retained as
`channel=other`, `product=unknown`, `platform=all`, `namingMatched=false`; their
spend is never silently discarded.

List dimensions accept `page` and `limit`. `limit` and page numbers are capped
at 100, and date ranges are capped at 90 days. The endpoint is rate-limited to
60 requests per minute by default.

All money totals are single-currency. If the organization contains more than
one account currency, the request must include a three-letter `currency`
parameter such as `currency=USD`; otherwise the endpoint returns HTTP 400.

Example:

```bash
curl -fsS \
  -H "Authorization: Bearer $AI_ADS_INTEGRATION_API_KEY" \
  "https://app.autoark.work/api/integrations/ai-ads?dimension=campaign&startDate=2026-07-25&endDate=2026-07-31&currency=USD&page=1&limit=100"
```

Responses contain `spend`, `revenue`/`purchase_value`, `roas`, impressions,
clicks, installs, CTR, CPC, CPM, and CPI. Campaign rows also contain optimizer,
status, objective, and account identity. `meta.freshness` identifies the newest
pre-aggregated row used by the requested dimension. `meta.coverage` reports the
number of scoped, covered, and missing accounts so partial Meta authorization
or aggregation gaps remain visible.

Delivery responses additionally contain `date`, `optimizer`, `channel`,
`product`, `platform`, `campaigns`, and `namingMatched`, plus
`meta.namingContract`. AutoArk performs this parsing and grouping; downstream
consumers must not independently reinterpret campaign names.

`revenue` is Meta-attributed purchase value, not payment-provider settlement or
audited entitlement revenue. Spend and purchase value retain the selected
account reporting currency and are not FX-normalized by this endpoint. `ctr` is
returned as a ratio from 0 to 1.
