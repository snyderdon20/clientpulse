-- Remove "---" placeholder values from all text fields on client profiles.
-- These were imported from CSV exports that use "---" for empty fields.

UPDATE clients SET
  email             = NULLIF(TRIM(email),             '---'),
  phone             = NULLIF(TRIM(phone),             '---'),
  address           = NULLIF(TRIM(address),           '---'),
  city              = NULLIF(TRIM(city),              '---'),
  state             = NULLIF(TRIM(state),             '---'),
  zip               = NULLIF(TRIM(zip),               '---'),
  referred_by       = NULLIF(TRIM(referred_by),       '---'),
  preferred_name    = NULLIF(TRIM(preferred_name),    '---'),
  contraindications = NULLIF(TRIM(contraindications), '---'),
  restricted_note   = NULLIF(TRIM(restricted_note),   '---'),
  acquisition_source= NULLIF(TRIM(acquisition_source),'---')
WHERE
  email              = '---' OR TRIM(email)              = '---' OR
  phone              = '---' OR TRIM(phone)              = '---' OR
  address            = '---' OR TRIM(address)            = '---' OR
  city               = '---' OR TRIM(city)               = '---' OR
  state              = '---' OR TRIM(state)              = '---' OR
  zip                = '---' OR TRIM(zip)                = '---' OR
  referred_by        = '---' OR TRIM(referred_by)        = '---' OR
  preferred_name     = '---' OR TRIM(preferred_name)     = '---' OR
  contraindications  = '---' OR TRIM(contraindications)  = '---' OR
  restricted_note    = '---' OR TRIM(restricted_note)    = '---' OR
  acquisition_source = '---' OR TRIM(acquisition_source) = '---';
