## Avatar link privacy

New portraits use opaque Worker URLs. In each scene that contains earlier Discord Arrivals tokens, open the GM’s Discord Arrivals panel and click **update legacy avatar links in this scene**. This updates the URL on existing Arrivals tokens while preserving their positions, ownership, and artwork. After upgrading all scenes, set the Worker variable `DISABLE_LEGACY_AVATAR_URLS` to `true` so old links stop serving images. Copies of images already downloaded remain outside the Worker's control.

To revoke an avatar, append its opaque ID (the first segment after `/token/v2/`) to the Worker's `AVATAR_REVOKED_IDS` variable, separated by commas. Revocation applies to all URLs for that Discord avatar image, including any legacy URL. Accounts using the same default Discord portrait share that image's ID. A revoked portrait stops loading on new requests. Keep the Worker’s signing secret stable to preserve existing token links.
