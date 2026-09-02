# Fixture attribution

`ga4/` is a verbatim copy of the GA4 sample bundle from
[GoogleCloudPlatform/open-knowledge-format](https://github.com/GoogleCloudPlatform/open-knowledge-format/tree/main/bundles/ga4),
licensed Apache-2.0. It is vendored so the test suite runs against a real,
agent-generated OKF bundle rather than only against hand-written examples.

`edge/` is hand-written for this project and covers what the reference bundle
does not: bundle-absolute links, broken links, `status`, `stale_after`, both
shapes of `verified`, `usage_window`, `okf_version`, a concept missing `type`,
unmodeled frontmatter keys, a `foo.md` / `foo/` route collision, a directory
with no `index.md`, and a `log.md`.
