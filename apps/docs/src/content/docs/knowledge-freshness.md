---
title: Knowledge freshness and versions
description: Schedule crawls, review unreachable pages, inspect document history, and edit text sources.
---

# Knowledge freshness and versions

URL and sitemap sources can be scheduled to recrawl every day, 7 days, or 30 days. The default
is off. A worker checks for due sources every 15 minutes and starts at most 25 sources per run;
the normal crawl limits still apply. Change the interval in the source details page.

The Freshness report lists documents that have not been checked in the selected number of days
(90 by default, from 7 to 365), plus every unreachable document. It can be filtered to one bot.
“Last checked” is the most recent successful or failed fetch. “Last changed” is the timestamp of
the current indexed version.

An **Unreachable** page returned HTTP 404 or 410, or could not be reached because of a DNS or
connection failure. Its last indexed version remains searchable during the outage. A successful
recrawl clears the marker. A **Removed** page no longer appears in the source sitemap; it is
excluded from retrieval while its version history remains available.

The document viewer lists versions and shows a text diff with three lines of context. Diffs are
limited to 200 KB. Text and uploaded file documents can be edited by an owner or admin; saving
creates a new version and queues it for embedding. Crawled URL and sitemap pages cannot be edited
because the next crawl would replace those changes.
