# Speech output options for the voice bridge

Researched 24 October 2026. No new provider was installed, no cloud synthesis was
called, and no comparative listening or latency benchmark was run. Recommendations
are candidates to audition, not measured quality rankings on this laptop.

## Recommendation

Start with **Kokoro-82M locally**, comparing it with the existing SAPI voice. If
cloud setup is acceptable, compare **Azure Neural Speech on F0** next, especially
for English (India). Keep SAPI and visible text as fallbacks. Consider Gemini or
ElevenLabs if a cloud voice wins the listening test. A full conversational model
is unnecessary just to read one already-written question.

Local synthesis has no per-request provider fee, but still needs model downloads,
runtime setup, RAM and CPU time. A cloud free tier is a quota, not unlimited free
service. Existing Codex access is treated as no additional out-of-pocket cost for
this user's current setup; its allowance has not been quantified, and it does not
grant free access to unrelated providers' APIs.

Kokoro's own [voice notes](https://huggingface.co/hexgrad/Kokoro-82M/raw/main/VOICES.md)
warn about weaker output for utterances below roughly 10–20 tokens. That overlaps
with this project's short questions and is a reason to audition the actual prompts,
not to pad questions with unnecessary speech. Azure may prove a better fit if the
short-prompt result or cold-start delay is poor.

## Shortlist

| Option | Cost / allowance | Fit and remaining work |
| --- | --- | --- |
| **Kokoro-82M v1.0, local** | No per-call fee; Apache-2.0 weights | First local candidate. 82M parameters, preset voices; investigate ONNX CPU deployment and compare cold/warm latency on Windows. English voice candidates: `af_heart`, `af_bella`, `bf_emma`, `bm_george`. No cloning needed. [Model](https://huggingface.co/hexgrad/Kokoro-82M), [voices](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md), [ONNX community implementation](https://github.com/thewh1teagle/kokoro-onnx). |
| **Piper, local** | No per-call fee; engine GPL-3.0; individual voice terms must be checked | Candidate for a small local speech component. Voice-dependent quality; audition against Kokoro. Phonemizer and model packaging still need Windows checks. [Maintained engine](https://github.com/OHF-Voice/piper1-gpl). |
| **Azure Neural Speech** | F0: **500,000 neural TTS characters/month**, with **20 transactions/minute** | Strong cloud-free-tier candidate. Requires an Azure Speech resource and credentials. Try standard `en-IN-NeerjaNeural` and `en-IN-PrabhatNeural`; verify regional availability and F0 eligibility. Do not assume premium HD voices share this allowance. [Pricing](https://azure.microsoft.com/en-us/pricing/details/speech/), [quotas](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits), [voices](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support). |
| **Gemini 3.8 Flash-Lite TTS** | Free tier listed, subject to limits. Paid Standard: **$0.50/1M text input tokens + $6/1M audio output tokens** through 31 December 2026 | Exact-text TTS with control of delivery. Output component approximately **$0.009/minute**, plus text input. Rates double on 1 January 2027. Free-tier data-use terms differ from paid. [TTS guide](https://ai.google.dev/gemini-api/docs/speech-generation), [pricing](https://ai.google.dev/gemini-api/docs/pricing). |
| **ElevenLabs v4 Turbo** | API list price **$0.04/1,000 characters**; free-plan allowances and model access are limited | Candidate for low-latency expressive delivery. Provider advertises about 100 ms latency; not measured here. A 200-character question costs **$0.008**, or **$0.80 for 100** at the listed usage rate, excluding plans/tax. Free creative plan lists 10K monthly credits and commercial licensing starts on paid plans; confirm the chosen API plan. [API pricing](https://elevenlabs.io/pricing/api), [plans](https://elevenlabs.io/pricing). |
| **OpenAI GPT-Realtime-2.1 Mini** | Paid API: **$0.60/1M text input tokens**, **$20/1M audio output tokens**; other modalities billed separately | Consider for a later realtime conversational redesign, not the simplest fixed-text speaker. It uses the Realtime API. Existing `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` are deprecated with shutdown scheduled **6 January 2027**; do not start a new long-lived Speech API integration around them. [Model/pricing](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini), [migration notice](https://developers.openai.com/api/docs/guides/text-to-speech). |

The Gemini minute estimate uses the provider's 25 audio tokens/second conversion:
1,500 tokens/minute times $6/1M tokens. Token rates from different providers do not
imply equal audio duration. The ElevenLabs calculation is character-based. Neither
calculation is an observed bill or a promise of latency or naturalness.

## Lower-priority options and lifecycle traps

- **edge-tts** accesses Microsoft's online Edge speech service from a community
  Python client. It is not local synthesis or the documented Azure Speech API.
  Treat it as an optional experiment; the repository does not establish an Azure
  service contract or an unlimited free production allowance. Prefer the supported
  Azure API for a maintained cloud path. [Project](https://github.com/rany2/edge-tts).
- **Supertonic 3** is a potentially useful local ONNX candidate (~99M parameters),
  but its official repository is archived, and the maintainer states that official
  open-source development/support has ended. The code is MIT; model weights have
  separate OpenRAIL-M terms. Keep it as an optional pinned experiment, not the
  default new dependency. [Archive and service notice](https://github.com/supertone-oss-archive/supertonic),
  [model license](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE).

## What to evaluate before choosing

Audition the same ten synthetic questions with SAPI and two candidate voices.
Include dates, money, spelling, Indian place names, abbreviations, option lists,
negation, and a correction. Score intelligibility and listening preference
separately from whether the question was useful. Only the task agent controls
which question to ask.

Measure time to first audible sound for cold and warm runs, full playback time,
CPU/RAM use, and time to stop speech after Cancel. Keep provider settings and the
exact text alongside results. Do not invent a latency ranking from vendor claims.
Do not cache personal field values or recorded replies to make the test faster.

For a future implementation, use a small cancellable `speak(text, signal)` / `stop()`
boundary. A synthesis failure should leave typed interaction available and invoke
the existing fallback without losing the pending request. Do not start Dictation
while prompt audio is playing; preserve the user's explicit microphone-start
action. Bind completed speech to the active request so stale audio cannot ask an
old question after cancellation. Keep model artifacts, credentials and generated
audio out of Git. This boundary is a proposal, not implemented provider support.
