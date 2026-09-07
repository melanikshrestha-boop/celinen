# Real photographic smoke-test fixtures

These three different, unmodified source photographs are for local decode, orientation,
plain-English edit preview, JPEG export/reopen, and project archive round-trip tests.
They are not generated images, a repeated-image load test, or a representative sports
culling benchmark. Do not claim model accuracy, burst selection quality, RAW support,
3,000-photo throughput, or a 90% success rate from this set.

Sources and the image-specific copyright statements were checked on 2026-09-04.
The licenses below apply to the photographs, not merely Commons page metadata.
No user photographs were searched or copied. Public-domain copyright status does
not imply a model release or endorsement by the depicted people or organizations;
these are technical test assets, not testimonial/advertising material.

## Files

### volleyball-portrait-cc0.jpg

- Creator: Jadegoke; photographed 2026-02-07.
- License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
- [Source and license declaration](https://commons.wikimedia.org/wiki/File:Volleyball_players_07-02-26.jpg).
- [Original JPEG](https://upload.wikimedia.org/wikipedia/commons/0/03/Volleyball_players_07-02-26.jpg).
- Download verified at 3,148,228 bytes; stored raster 4,000 × 3,000 with EXIF
  orientation 6 (rotate 90° clockwise for 3,000 × 4,000 portrait display).
  The byte-level orientation was checked with LensLabs' `readExifOrientation`;
  the upright portrait was also visually inspected.
- Scenario: outdoor volleyball action with multiple people, natural-light colors,
  portrait aspect, and a real EXIF orientation transform. Samsung Galaxy S23+ JPEG.

### basketball-hangar-usnavy-pd.jpg

- Creator: Mass Communication Specialist 2nd Class Ryan D. McLearnon, U.S. Navy;
  photographed 2013-05-13.
- License: public domain in the United States as an official U.S. federal-government
  employee work (Commons PD-US-Navy designation and original Public Domain metadata).
- [Source and copyright statement](https://commons.wikimedia.org/wiki/File:Basketball_game_in_hangar_bay_130513-N-GC639-126.jpg).
- [Original JPEG](https://upload.wikimedia.org/wikipedia/commons/2/29/Basketball_game_in_hangar_bay_130513-N-GC639-126.jpg).
- Download verified at 4,256 × 2,832 pixels, 1,174,531 bytes and EXIF orientation 1.
  Nikon D700, ISO 1000, 1/160-second exposure.
- Scenario: several players following a jump shot inside an aircraft-carrier hangar,
  mixed artificial light, dark shadows, bright ceiling lights and a landscape frame.

### basketball-action-usaf-pd.jpg

- Creator: Technical Sgt. Dawn M. Price, U.S. Air Force; photographed 2009-04-10.
- License: public domain in the United States as an official U.S. federal-government
  employee work (Commons PD-US-Air Force designation). Do not imply military endorsement.
- [Commons source and copyright statement](https://commons.wikimedia.org/wiki/File:Basketball_game_at_Camp_Lemonnier_DVIDS164942.jpg).
- [Official DVIDS source](https://www.dvidshub.net/image/164942).
- [Original JPEG](https://upload.wikimedia.org/wikipedia/commons/3/3e/Basketball_game_at_Camp_Lemonnier_DVIDS164942.jpg).
- Download verified at 2,256 × 1,420 pixels, 3,032,556 bytes, EXIF orientation 1;
  Nikon D3, ISO 3200, 1/100-second exposure, flash.
- Scenario: basketball dribbling action with multiple subjects, darker background,
  flash/high-ISO capture and a landscape composition.

## Download integrity

All three originals were visually inspected and checked as real decodable JPEGs.
Combined size: 7,355,315 bytes. Each file is below 5,000,000 bytes; the set is below
15,000,000 bytes. No resizes, crops, re-encodes or metadata edits were performed.

| File | SHA-256 |
| --- | --- |
| volleyball-portrait-cc0.jpg | `5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce` |
| basketball-action-usaf-pd.jpg | `716ebc16299ef61adf2e73ad798505d67fc4dfa0dfab0bed228f13834d50ab5a` |
| basketball-hangar-usnavy-pd.jpg | `cb8e1799a10fc4d315f7f80628f552a95c75296db1c37473839d380b42d9c80d` |

A fourth candidate, Commons `Voleibol Femenino.jpg`, was not retained: its image
page stated public domain but its embedded JPEG comment referenced CC-BY-SA-2.1.
It was conservatively replaced with the Navy source above; no copy remains here.

## Usage boundary

Keep all three source files unchanged. Write edited exports to a separate QA output
directory, not over the fixtures. A restored project should preserve source hashes;
an edited export should decode, preserve the requested composition, and differ from
the source only according to the selected edit. Check orientation visually rather
than trusting encoded JPEG width/height alone. None of these three files are RAW.
