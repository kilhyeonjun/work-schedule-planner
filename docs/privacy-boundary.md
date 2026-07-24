# Privacy boundary

This demonstration starts at a vendor-neutral normalized schema. It does not contain an adapter, live collector, account linkage, operational cache reader, arbitrary upload, or server API.

All fixtures are generated from fixed seed `7601` with dates in 2042. They are newly generated synthetic records, not anonymized operational records. Every input and result is stamped `dataOrigin: synthetic` and includes generator name, version, and seed.

The release boundary scanner covers source, schema, fixtures, generated demo data, and built web assets. It rejects private absolute paths, private network addresses, employer or product-vendor markers, and sensitive transport or identity field vocabulary. The scanner reports only category counts and file locations, never matched values.
