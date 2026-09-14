# Canonical V2 native service dependency notices

The decoder uses the exact unmodified archives/profile in `canonical-v2.lock.json`:
libjpeg-turbo 3.1.4.1, LittleCMS 2.19.1, LibRaw 0.22.2, ICC sRGB2014.
Their upstream license notices and exact source archives accompany this image.
LibRaw is used under its offered CDDL 1.0 option; its library source is unmodified.

The HTTP transport is cpp-httplib 0.56.0, commit
`278c2979e8c68468960c3073e28e1c51b098d6a4`, MIT licensed. The build verifies the
header SHA-256 `1f99e51881c4c9d0649b27c611442c2f4d9bcfec5a22a14d5fcd1f8106f730b4`.
The upstream LICENSE is included. It does not decode or transform images.

ICC states that profiles owned by ICC may be copied, distributed, embedded,
made, used and sold without restriction; altered profiles must lose ICC/original
identification. The sRGB2014 profile in this image is unchanged and hash-verified.
See https://registry.color.org/profile-library/ and the embedded profile copyright.

The Ubuntu runtime is pinned to its native AMD64 image manifest digest. OS license
notices remain in that base. Decoder libraries are static; no OS image decoder,
color profile discovery, OpenCV, model, frontend, photographs, credentials, XMP
writer or publishing code is included.
