# Doctor Hospital And Chamber Location Data Model

```mermaid
erDiagram
  DOCTOR_LOCATIONS {
    bigint id PK
    text doc_id UK
    text doctor_name
    text designation
    text team
    text rse
    text ase
    text territory

    text hospital_name
    text hospital_address
    numeric hospital_latitude
    numeric hospital_longitude
    text hospital_confidence
    text hospital_source
    text hospital_matched_name
    text hospital_matched_address
    text hospital_place_id
    text hospital_location_type
    boolean hospital_partial_match
    text hospital_status
    integer hospital_retry_count
    timestamptz hospital_last_attempted_at
    timestamptz hospital_resolved_at
    text hospital_error_message
    text_array hospital_reasons

    text chamber_name
    text chamber_address
    numeric chamber_latitude
    numeric chamber_longitude
    text chamber_confidence
    text chamber_source
    text chamber_matched_name
    text chamber_matched_address
    text chamber_place_id
    text chamber_location_type
    boolean chamber_partial_match
    text chamber_status
    integer chamber_retry_count
    timestamptz chamber_last_attempted_at
    timestamptz chamber_resolved_at
    text chamber_error_message
    text_array chamber_reasons

    timestamptz created_at
    timestamptz updated_at
  }
```

This table treats hospital and chamber as two independent coordinate targets for the same doctor.

That means one doctor can have:

- a resolved hospital coordinate and a pending chamber coordinate
- a low-confidence chamber coordinate and a high-confidence hospital coordinate
- separate retry counts, errors, matched addresses, and source metadata

