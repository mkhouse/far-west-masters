-- Migration 0016 — correct the SMS cost estimate from a real invoice
--
-- The default was $0.0109, built from Twilio's published US rate plus the A2P 10DLC
-- carrier surcharge. FWM sends from a TOLL-FREE number, which is priced differently,
-- so that guess was 11% low.
--
-- From the March 2026 invoice, the club's busiest month:
--
--   312 outbound segments
--   $2.59  base toll-free SMS       ($0.0083/segment)
--   $1.19  carrier fees             ($0.0038/segment)
--   ------
--   $3.78  total                    ($0.0121/segment)
--
-- Toll-free does carry carrier fees, contrary to what the published pricing pages
-- imply — they are simply itemised separately, one line per carrier.
--
-- Not included, because they do not vary with what is sent: the toll-free number
-- itself is $2.15/month. That month's entire invoice was $5.93.
--
-- Safe to run after migrations 0001-0015.

update app_settings
set value = '0.0121',
    description =
      'Estimated cost in USD of one outbound SMS segment. Measured from the March '
      '2026 Twilio invoice: 312 segments, $3.78 including per-carrier fees, on a '
      'toll-free number. Excludes the $2.15/month number rental. Re-check against a '
      'recent invoice if rates change.',
    updated_at = now()
where key = 'sms_cost_per_segment_usd';
