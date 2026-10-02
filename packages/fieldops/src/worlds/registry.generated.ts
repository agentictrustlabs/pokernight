/**
 * GENERATED FROM THE PUBLIC REGISTRY — do not edit by hand.
 *
 * Source: gc-public (https://graphdb.agentkg.io), read 2026-10-01T20:55:25.043Z by scripts/registry-to-fieldops.mjs.
 * Each entry is a gc:PeopleCommunity north of Denver with its identity, cited, and the phase its latest
 * gc:CommunityPhaseResult assigned in fw-npl-phases — the floor a season opens from. Rebuild: `pnpm gen:fieldops`
 */
export interface RegistryCommunity {
  id: string; iri: string; name: string; corridor: string; peopleName: string;
  identity: { iri: string; label: string; scheme: string };
  ropId?: string; peid?: string; pgId?: string; language?: string; religion?: string; homeCountry?: string;
  phase: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; resultDate: string | null; hasResult: boolean;
}
export const REGISTRY_READ_AT = "2026-10-01T20:55:25.044Z";
export const REGISTRY_COMMUNITIES: RegistryCommunity[] = [
  {
    "id": "chinese-americans-boulder",
    "iri": "https://graph.global.church/community/119471rop3imb-boulder-broomfield",
    "name": "Chinese Americans — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Chinese Americans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/chinese-americans-boulder-longmont-corridor",
      "label": "Chinese Americans — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "119471",
    "peid": "50453",
    "pgId": "PG050453",
    "language": "english",
    "homeCountry": "United States",
    "phase": 4,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "filipinos-boulder",
    "iri": "https://graph.global.church/community/109692rop3imb-boulder-broomfield",
    "name": "Filipinos — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Filipinos",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/filipinos-boulder-longmont-corridor",
      "label": "Filipinos — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "109692",
    "peid": "43239",
    "pgId": "PG043239",
    "language": "tagalog",
    "homeCountry": "Philippines",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "gujaratis-boulder",
    "iri": "https://graph.global.church/community/103544rop3imb-boulder-broomfield",
    "name": "Gujaratis — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Gujaratis",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/gujaratis-boulder-longmont-corridor",
      "label": "Gujaratis — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103544",
    "peid": "47180",
    "pgId": "PG047180",
    "language": "gujarati",
    "homeCountry": "India",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "han-chinese-mandarin-boulder",
    "iri": "https://graph.global.church/community/103686rop3imb-boulder-broomfield",
    "name": "Han Chinese (Mandarin) — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Han Chinese (Mandarin)",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/han-chinese-mandarin-boulder-longmont-corridor",
      "label": "Han Chinese (Mandarin) — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103686",
    "peid": "43261",
    "pgId": "PG043261",
    "language": "mandarin",
    "homeCountry": "China",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "hindi-boulder",
    "iri": "https://graph.global.church/community/103789rop3imb-boulder-broomfield",
    "name": "Hindi — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Hindi",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/hindi-boulder-longmont-corridor",
      "label": "Hindi — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103789",
    "peid": "47203",
    "pgId": "PG047203",
    "language": "hindi",
    "homeCountry": "India",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "koreans-boulder",
    "iri": "https://graph.global.church/community/105225rop3imb-boulder-broomfield",
    "name": "Koreans — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Koreans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/koreans-boulder-longmont-corridor",
      "label": "Koreans — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "105225",
    "peid": "43310",
    "pgId": "PG043310",
    "language": "korean",
    "homeCountry": "Korea",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "persians-boulder",
    "iri": "https://graph.global.church/community/100308rop3-boulder-broomfield",
    "name": "Persians — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Persians",
    "identity": {
      "iri": "https://graph.global.church/pg/persian",
      "label": "Persian",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "107987",
    "peid": "43278",
    "pgId": "PG043278",
    "homeCountry": "Iran",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "punjabis-boulder",
    "iri": "https://graph.global.church/community/100146rop3-boulder-broomfield",
    "name": "Punjabis — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Punjabis",
    "identity": {
      "iri": "https://graph.global.church/pg/punjabi",
      "label": "Punjabi",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "108182",
    "peid": "43605",
    "pgId": "PG043605",
    "homeCountry": "India",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "russians-boulder",
    "iri": "https://graph.global.church/community/108452rop3imb-boulder-broomfield",
    "name": "Russians — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Russians",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/russians-boulder-longmont-corridor",
      "label": "Russians — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "108452",
    "peid": "46469",
    "pgId": "PG046469",
    "language": "russian",
    "homeCountry": "Russia",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "sikhs-boulder",
    "iri": "https://graph.global.church/community/119363rop3imb-boulder-broomfield",
    "name": "Sikhs — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Sikhs",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/sikhs-boulder-longmont-corridor",
      "label": "Sikhs — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "119363",
    "peid": "50374",
    "pgId": "PG050374",
    "language": "punjabi",
    "homeCountry": "India",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "sudanese-boulder",
    "iri": "https://graph.global.church/community/4f1localfield-boulder-broomfield",
    "name": "Sudanese — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Sudanese",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/sudanese",
      "label": "Sudanese",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "arabic juba sudanese colloquial",
    "phase": 1,
    "resultDate": "2026-08",
    "hasResult": true
  },
  {
    "id": "tibetans-boulder",
    "iri": "https://graph.global.church/community/100096rop3-boulder-broomfield",
    "name": "Tibetans — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Tibetans",
    "identity": {
      "iri": "https://graph.global.church/pg/tibetan",
      "label": "Tibetan",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "110033",
    "peid": "47305",
    "pgId": "PG047305",
    "homeCountry": "Tibet",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "ukrainians-boulder",
    "iri": "https://graph.global.church/community/110376rop3imb-boulder-broomfield",
    "name": "Ukrainians — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Ukrainians",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/ukrainians-boulder-longmont-corridor",
      "label": "Ukrainians — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "110376",
    "peid": "43666",
    "pgId": "PG043666",
    "language": "ukrainian",
    "homeCountry": "Ukraine",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "vietnamese-boulder",
    "iri": "https://graph.global.church/community/105018rop3imb-boulder-broomfield",
    "name": "Vietnamese — Boulder · Broomfield",
    "corridor": "boulder",
    "peopleName": "Vietnamese",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/vietnamese-boulder-longmont-corridor",
      "label": "Vietnamese — Boulder–Longmont Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "105018",
    "peid": "43675",
    "pgId": "PG043675",
    "language": "vietnamese",
    "homeCountry": "Vietnam",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "afghans-larimer",
    "iri": "https://graph.global.church/community/115238rop3imb-larimer",
    "name": "Afghans — Larimer",
    "corridor": "larimer",
    "peopleName": "Afghans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/afghans-fort-collins-loveland",
      "label": "Afghans — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "115238",
    "peid": "46478",
    "pgId": "PG046478",
    "language": "dari",
    "homeCountry": "Afghanistan",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "american-spanish-larimer",
    "iri": "https://graph.global.church/community/100288rop3imb-larimer",
    "name": "American (Spanish) — Larimer",
    "corridor": "larimer",
    "peopleName": "American (Spanish)",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/american-spanish-fort-collins-loveland",
      "label": "American (Spanish) — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "100288",
    "peid": "43518",
    "pgId": "PG043518",
    "language": "spanish",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "guatemalans-larimer",
    "iri": "https://graph.global.church/community/103510rop3imb-larimer",
    "name": "Guatemalans — Larimer",
    "corridor": "larimer",
    "peopleName": "Guatemalans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/guatemalans-fort-collins-loveland",
      "label": "Guatemalans — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103510",
    "peid": "46516",
    "pgId": "PG046516",
    "language": "spanish",
    "homeCountry": "Guatemala",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "han-chinese-mandarin-larimer",
    "iri": "https://graph.global.church/community/103686rop3imb-larimer",
    "name": "Han Chinese (Mandarin) — Larimer",
    "corridor": "larimer",
    "peopleName": "Han Chinese (Mandarin)",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/han-chinese-mandarin-fort-collins-loveland",
      "label": "Han Chinese (Mandarin) — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103686",
    "peid": "43261",
    "pgId": "PG043261",
    "language": "mandarin",
    "homeCountry": "China",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "hindi-larimer",
    "iri": "https://graph.global.church/community/103789rop3imb-larimer",
    "name": "Hindi — Larimer",
    "corridor": "larimer",
    "peopleName": "Hindi",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/hindi-fort-collins-loveland",
      "label": "Hindi — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103789",
    "peid": "47203",
    "pgId": "PG047203",
    "language": "hindi",
    "homeCountry": "India",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "mexicans-larimer",
    "iri": "https://graph.global.church/community/106577rop3imb-larimer",
    "name": "Mexicans — Larimer",
    "corridor": "larimer",
    "peopleName": "Mexicans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/mexicans-fort-collins-loveland",
      "label": "Mexicans — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "106577",
    "peid": "46513",
    "pgId": "PG046513",
    "language": "spanish",
    "homeCountry": "Mexico",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "nepalis-larimer",
    "iri": "https://graph.global.church/community/107204rop3imb-larimer",
    "name": "Nepalis — Larimer",
    "corridor": "larimer",
    "peopleName": "Nepalis",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/nepalis-fort-collins-loveland",
      "label": "Nepalis — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "107204",
    "peid": "43559",
    "pgId": "PG043559",
    "language": "nepali",
    "homeCountry": "Nepal",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "russians-larimer",
    "iri": "https://graph.global.church/community/108452rop3imb-larimer",
    "name": "Russians — Larimer",
    "corridor": "larimer",
    "peopleName": "Russians",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/russians-fort-collins-loveland",
      "label": "Russians — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "108452",
    "peid": "46469",
    "pgId": "PG046469",
    "language": "russian",
    "homeCountry": "Russia",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "somalis-larimer",
    "iri": "https://graph.global.church/community/100395rop3-larimer",
    "name": "Somalis — Larimer",
    "corridor": "larimer",
    "peopleName": "Somalis",
    "identity": {
      "iri": "https://graph.global.church/pg/somali",
      "label": "Somali",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "109392",
    "peid": "43631",
    "pgId": "PG043631",
    "homeCountry": "Somalia",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "vietnamese-larimer",
    "iri": "https://graph.global.church/community/105018rop3imb-larimer",
    "name": "Vietnamese — Larimer",
    "corridor": "larimer",
    "peopleName": "Vietnamese",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/vietnamese-fort-collins-loveland",
      "label": "Vietnamese — Fort Collins–Loveland",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "105018",
    "peid": "43675",
    "pgId": "PG043675",
    "language": "vietnamese",
    "homeCountry": "Vietnam",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "afghans-plains",
    "iri": "https://graph.global.church/community/115238rop3imb-morgan-logan-yuma",
    "name": "Afghans — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Afghans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/afghans-northeast-plains",
      "label": "Afghans — Northeast Plains",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "115238",
    "peid": "46478",
    "pgId": "PG046478",
    "language": "dari",
    "homeCountry": "Afghanistan",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "american-spanish-plains",
    "iri": "https://graph.global.church/community/100288rop3imb-morgan-logan-yuma",
    "name": "American (Spanish) — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "American (Spanish)",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/american-spanish-northeast-plains",
      "label": "American (Spanish) — Northeast Plains",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "100288",
    "peid": "43518",
    "pgId": "PG043518",
    "language": "spanish",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "burmese-plains",
    "iri": "https://graph.global.church/community/101776rop3imb-morgan-logan-yuma",
    "name": "Burmese — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Burmese",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/burmese-northeast-plains",
      "label": "Burmese — Northeast Plains",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "101776",
    "peid": "47239",
    "pgId": "PG047239",
    "language": "burmese",
    "homeCountry": "Myanmar",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "francophone-west-central-africans-plains",
    "iri": "https://graph.global.church/community/2f2localfield-morgan-logan-yuma",
    "name": "Francophone West & Central Africans — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Francophone West & Central Africans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/francophone-west-central-africans",
      "label": "Francophone West & Central Africans",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "french",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "guatemalans-plains",
    "iri": "https://graph.global.church/community/103510rop3imb-morgan-logan-yuma",
    "name": "Guatemalans — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Guatemalans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/guatemalans-northeast-plains",
      "label": "Guatemalans — Northeast Plains",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103510",
    "peid": "46516",
    "pgId": "PG046516",
    "language": "spanish",
    "homeCountry": "Guatemala",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "men-in-sterling-correctional-and-those-released-plains",
    "iri": "https://graph.global.church/community/2f7localfield-morgan-logan-yuma",
    "name": "Men in Sterling Correctional and those released — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Men in Sterling Correctional and those released",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/men-in-sterling-correctional-and-those-released",
      "label": "Men in Sterling Correctional and those released",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "english",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "mexicans-plains",
    "iri": "https://graph.global.church/community/106577rop3imb-morgan-logan-yuma",
    "name": "Mexicans — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Mexicans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/mexicans-northeast-plains",
      "label": "Mexicans — Northeast Plains",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "106577",
    "peid": "46513",
    "pgId": "PG046513",
    "language": "spanish",
    "homeCountry": "Mexico",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "q-anjob-al-maya-plains",
    "iri": "https://graph.global.church/community/2f1localfield-morgan-logan-yuma",
    "name": "Q'anjob'al Maya — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Q'anjob'al Maya",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/q-anjob-al-maya",
      "label": "Q'anjob'al Maya",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "q anjob al",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "rohingya-plains",
    "iri": "https://graph.global.church/community/100175rop3-morgan-logan-yuma",
    "name": "Rohingya — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Rohingya",
    "identity": {
      "iri": "https://graph.global.church/pg/rohingya",
      "label": "Rohingya",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "102170",
    "peid": "50359",
    "pgId": "PG050359",
    "homeCountry": "Myanmar",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "rural-adults-in-addiction-plains",
    "iri": "https://graph.global.church/community/2f4localfield-morgan-logan-yuma",
    "name": "Rural adults in addiction — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Rural adults in addiction",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/rural-adults-in-addiction",
      "label": "Rural adults in addiction",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "english",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "somali-bantus-plains",
    "iri": "https://graph.global.church/community/103458rop3imb-morgan-logan-yuma",
    "name": "Somali Bantus — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Somali Bantus",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/somali-bantus-northeast-plains",
      "label": "Somali Bantus — Northeast Plains",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103458",
    "peid": "50352",
    "pgId": "PG050352",
    "language": "maay",
    "homeCountry": "Somalia",
    "phase": 1,
    "resultDate": "2026-08",
    "hasResult": true
  },
  {
    "id": "somalis-plains",
    "iri": "https://graph.global.church/community/100395rop3-morgan-logan-yuma",
    "name": "Somalis — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Somalis",
    "identity": {
      "iri": "https://graph.global.church/pg/somali",
      "label": "Somali",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "109392",
    "peid": "43631",
    "pgId": "PG043631",
    "homeCountry": "Somalia",
    "phase": 1,
    "resultDate": "2026-08",
    "hasResult": true
  },
  {
    "id": "the-deaf-of-the-northeast-plains-plains",
    "iri": "https://graph.global.church/community/2f6localfield-morgan-logan-yuma",
    "name": "The Deaf of the Northeast Plains — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "The Deaf of the Northeast Plains",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/the-deaf-of-the-northeast-plains",
      "label": "The Deaf of the Northeast Plains",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "american sign language",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "unpaid-family-caregivers-plains",
    "iri": "https://graph.global.church/community/2f5localfield-morgan-logan-yuma",
    "name": "Unpaid family caregivers — Morgan · Logan · Yuma",
    "corridor": "plains",
    "peopleName": "Unpaid family caregivers",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/unpaid-family-caregivers",
      "label": "Unpaid family caregivers",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "english",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "afghans-weld",
    "iri": "https://graph.global.church/community/115238rop3imb-weld",
    "name": "Afghans — Weld",
    "corridor": "weld",
    "peopleName": "Afghans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/afghans-greeley-evans-corridor",
      "label": "Afghans — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "115238",
    "peid": "46478",
    "pgId": "PG046478",
    "language": "dari",
    "homeCountry": "Afghanistan",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "american-spanish-weld",
    "iri": "https://graph.global.church/community/100288rop3imb-weld",
    "name": "American (Spanish) — Weld",
    "corridor": "weld",
    "peopleName": "American (Spanish)",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/american-spanish-greeley-evans-corridor",
      "label": "American (Spanish) — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "100288",
    "peid": "43518",
    "pgId": "PG043518",
    "language": "spanish",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "at-risk-and-disconnected-youth-weld",
    "iri": "https://graph.global.church/community/1f6localfield-weld",
    "name": "At-risk and disconnected youth — Weld",
    "corridor": "weld",
    "peopleName": "At-risk and disconnected youth",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/at-risk-and-disconnected-youth",
      "label": "At-risk and disconnected youth",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "english bilingual english spanish",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "burmese-weld",
    "iri": "https://graph.global.church/community/101776rop3imb-weld",
    "name": "Burmese — Weld",
    "corridor": "weld",
    "peopleName": "Burmese",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/burmese-greeley-evans-corridor",
      "label": "Burmese — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "101776",
    "peid": "47239",
    "pgId": "PG047239",
    "language": "burmese",
    "homeCountry": "Myanmar",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "burundians-weld",
    "iri": "https://graph.global.church/community/101785rop3imb-weld",
    "name": "Burundians — Weld",
    "corridor": "weld",
    "peopleName": "Burundians",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/burundians-greeley-evans-corridor",
      "label": "Burundians — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "101785",
    "peid": "47181",
    "pgId": "PG047181",
    "language": "french",
    "homeCountry": "Burundi",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "chuukese-weld",
    "iri": "https://graph.global.church/community/1f1localfield-weld",
    "name": "Chuukese — Weld",
    "corridor": "weld",
    "peopleName": "Chuukese",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/chuukese",
      "label": "Chuukese",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "chuukese",
    "phase": 4,
    "resultDate": "2026-08",
    "hasResult": true
  },
  {
    "id": "congolese-weld",
    "iri": "https://graph.global.church/community/105785rop3imb-weld",
    "name": "Congolese — Weld",
    "corridor": "weld",
    "peopleName": "Congolese",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/congolese-greeley-evans-corridor",
      "label": "Congolese — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "105785",
    "peid": "47246",
    "pgId": "PG047246",
    "language": "lingala",
    "homeCountry": "DR Congo",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "eritreans-weld",
    "iri": "https://graph.global.church/community/117091rop3imb-weld",
    "name": "Eritreans — Weld",
    "corridor": "weld",
    "peopleName": "Eritreans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/eritreans-greeley-evans-corridor",
      "label": "Eritreans — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "117091",
    "peid": "47194",
    "pgId": "PG047194",
    "language": "tigre",
    "homeCountry": "Eritrea",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "guatemalans-weld",
    "iri": "https://graph.global.church/community/103510rop3imb-weld",
    "name": "Guatemalans — Weld",
    "corridor": "weld",
    "peopleName": "Guatemalans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/guatemalans-greeley-evans-corridor",
      "label": "Guatemalans — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103510",
    "peid": "46516",
    "pgId": "PG046516",
    "language": "spanish",
    "homeCountry": "Guatemala",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "mexicans-weld",
    "iri": "https://graph.global.church/community/106577rop3imb-weld",
    "name": "Mexicans — Weld",
    "corridor": "weld",
    "peopleName": "Mexicans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/mexicans-greeley-evans-corridor",
      "label": "Mexicans — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "106577",
    "peid": "46513",
    "pgId": "PG046513",
    "language": "spanish",
    "homeCountry": "Mexico",
    "phase": 3,
    "resultDate": "2026-06",
    "hasResult": true
  },
  {
    "id": "pwo-karen-weld",
    "iri": "https://graph.global.church/community/104659rop3imb-weld",
    "name": "Pwo Karen — Weld",
    "corridor": "weld",
    "peopleName": "Pwo Karen",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/pwo-karen-greeley-evans-corridor",
      "label": "Pwo Karen — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "104659",
    "peid": "50363",
    "pgId": "PG050363",
    "language": "karen pwo eastern",
    "homeCountry": "Myanmar",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "rohingya-weld",
    "iri": "https://graph.global.church/community/100175rop3-weld",
    "name": "Rohingya — Weld",
    "corridor": "weld",
    "peopleName": "Rohingya",
    "identity": {
      "iri": "https://graph.global.church/pg/rohingya",
      "label": "Rohingya",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "102170",
    "peid": "50359",
    "pgId": "PG050359",
    "homeCountry": "Myanmar",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "romanians-weld",
    "iri": "https://graph.global.church/community/1f2localfield-weld",
    "name": "Romanians — Weld",
    "corridor": "weld",
    "peopleName": "Romanians",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/romanians",
      "label": "Romanians",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "romanian",
    "phase": 4,
    "resultDate": "2026-08",
    "hasResult": true
  },
  {
    "id": "rwandans-weld",
    "iri": "https://graph.global.church/community/108463rop3imb-weld",
    "name": "Rwandans — Weld",
    "corridor": "weld",
    "peopleName": "Rwandans",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/rwandans-greeley-evans-corridor",
      "label": "Rwandans — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "108463",
    "peid": "47295",
    "pgId": "PG047295",
    "language": "kinyarwanda",
    "homeCountry": "Rwanda",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "s-gaw-karen-weld",
    "iri": "https://graph.global.church/community/100207rop3-weld",
    "name": "S'gaw Karen — Weld",
    "corridor": "weld",
    "peopleName": "S'gaw Karen",
    "identity": {
      "iri": "https://graph.global.church/pg/karen",
      "label": "Karen",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "108886",
    "peid": "47263",
    "pgId": "PG047263",
    "homeCountry": "Myanmar",
    "phase": 4,
    "resultDate": "2026-08",
    "hasResult": true
  },
  {
    "id": "somali-bantus-weld",
    "iri": "https://graph.global.church/community/103458rop3imb-weld",
    "name": "Somali Bantus — Weld",
    "corridor": "weld",
    "peopleName": "Somali Bantus",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/somali-bantus-greeley-evans-corridor",
      "label": "Somali Bantus — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "103458",
    "peid": "50352",
    "pgId": "PG050352",
    "language": "maay",
    "homeCountry": "Somalia",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "somalis-weld",
    "iri": "https://graph.global.church/community/100395rop3-weld",
    "name": "Somalis — Weld",
    "corridor": "weld",
    "peopleName": "Somalis",
    "identity": {
      "iri": "https://graph.global.church/pg/somali",
      "label": "Somali",
      "scheme": "https://graph.global.church/scheme/joshua-project"
    },
    "ropId": "109392",
    "peid": "43631",
    "pgId": "PG043631",
    "homeCountry": "Somalia",
    "phase": 1,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "swahili-weld",
    "iri": "https://graph.global.church/community/109644rop3imb-weld",
    "name": "Swahili — Weld",
    "corridor": "weld",
    "peopleName": "Swahili",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/swahili-greeley-evans-corridor",
      "label": "Swahili — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "ropId": "109644",
    "peid": "47306",
    "pgId": "PG047306",
    "language": "swahili",
    "homeCountry": "Tanzania",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "the-deaf-of-weld-county-weld",
    "iri": "https://graph.global.church/community/1f5localfield-weld",
    "name": "The Deaf of Weld County — Weld",
    "corridor": "weld",
    "peopleName": "The Deaf of Weld County",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/the-deaf-of-weld-county",
      "label": "The Deaf of Weld County",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "american sign language",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  },
  {
    "id": "tigrai-weld",
    "iri": "https://graph.global.church/community/110050rop3imb-weld",
    "name": "Tigrai — Weld",
    "corridor": "weld",
    "peopleName": "Tigrai",
    "identity": {
      "iri": "https://graph.global.church/pg/alliance/tigrai-greeley-evans-corridor",
      "label": "Tigrai — Greeley–Evans Corridor",
      "scheme": "https://graph.global.church/scheme/colorado-impact-project"
    },
    "language": "tigrigna",
    "homeCountry": "Ethiopia",
    "phase": 0,
    "resultDate": null,
    "hasResult": true
  }
];
