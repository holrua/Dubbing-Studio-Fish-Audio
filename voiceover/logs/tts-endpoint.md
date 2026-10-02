> ## Documentation Index
> Fetch the complete documentation index at: https://docs.fish.audio/llms.txt
> Use this file to discover all available pages before exploring further.

# Text to Speech

> Convert text to speech

<Warning>
  This endpoint only accepts `application/json` and `application/msgpack`.

  For best results, upload reference audio using the [create model](/api-reference/endpoint/model/create-model) before using this one. This improves speech quality and reduces latency.

  To upload audio clips directly, without pre-uploading, serialize the request body with MessagePack as per the [instructions](/features/text-to-speech#direct-api-messagepack).
</Warning>

<Note>
  Audio formats supported:

  * WAV / PCM
    * Sample Rate: 8kHz, 16kHz, 24kHz, 32kHz, 44.1kHz
    * Default Sample Rate: 44.1kHz
    * 16-bit, mono
  * MP3
    * Sample Rate: 32kHz, 44.1kHz
    * Default Sample Rate: 44.1kHz
    * mono
    * Bitrate: 64kbps, 128kbps (default), 192kbps
  * Opus
    * Sample Rate: 48kHz
    * Default Sample Rate: 48kHz
    * mono
    * Bitrate: -1000 (auto), 24kbps, 32kbps (default), 48kbps, 64kbps
</Note>


## OpenAPI

````yaml post /v1/tts
openapi: 3.1.0
info:
  title: FishAudio OpenAPI
  version: '1'
servers:
  - description: Fish Audio API
    url: https://api.fish.audio
security: []
tags: []
paths:
  /v1/tts:
    post:
      tags:
        - OpenAPI v1
      summary: Text to Speech
      parameters:
        - in: header
          name: model
          description: >-
            Specify which TTS model to use. Use `s2.1-pro-free` for the free
            developer tier. `drama-3-preview` is a preview model; its behavior
            and availability may change. If omitted or set to an unrecognized
            value, the request falls back to `s2.1-pro`.
          required: false
          schema:
            default: s2.1-pro
            enum:
              - s1
              - s2-pro
              - s2.1-pro
              - s2.1-pro-free
              - drama-3-preview
            title: Model
            type: string
          deprecated: false
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TTSRequest'
          application/msgpack:
            schema:
              $ref: '#/components/schemas/TTSRequest'
      responses:
        '200':
          description: Request fulfilled, document follows
          headers:
            Transfer-Encoding:
              schema:
                type: string
              description: chunked
        '401':
          description: No permission -- see authorization schemes
          headers: {}
          content:
            application/json:
              schema:
                properties:
                  status:
                    title: Status
                    type: integer
                  message:
                    title: Message
                    type: string
                  reason:
                    anyOf:
                      - type: string
                      - type: 'null'
                    default: null
                    title: Reason
                required:
                  - status
                  - message
                type: object
        '402':
          description: No payment -- see charging schemes
          headers: {}
          content:
            application/json:
              schema:
                properties:
                  status:
                    title: Status
                    type: integer
                  message:
                    title: Message
                    type: string
                  reason:
                    anyOf:
                      - type: string
                      - type: 'null'
                    default: null
                    title: Reason
                required:
                  - status
                  - message
                type: object
        '503':
          description: The server cannot process the request due to a high load
          headers: {}
          content:
            application/json:
              schema:
                properties:
                  status:
                    title: Status
                    type: integer
                  message:
                    title: Message
                    type: string
                  reason:
                    anyOf:
                      - type: string
                      - type: 'null'
                    default: null
                    title: Reason
                required:
                  - status
                  - message
                type: object
      security:
        - BearerAuth: []
      x-codeSamples:
        - lang: bash
          label: Single Speaker
          source: |-
            curl --request POST \
              --url https://api.fish.audio/v1/tts \
              --header 'Authorization: Bearer <token>' \
              --header 'Content-Type: application/json' \
              --header 'model: s2.1-pro-free' \
              --data '{
                "text": "Hello! Welcome to Fish Audio.",
                "reference_id": "model-id",
                "temperature": 0.7,
                "top_p": 0.7,
                "prosody": {
                  "speed": 1,
                  "volume": 0,
                  "normalize_loudness": true
                },
                "chunk_length": 300,
                "normalize": true,
                "format": "mp3",
                "sample_rate": 44100,
                "mp3_bitrate": 128,
                "latency": "normal",
                "max_new_tokens": 1024,
                "repetition_penalty": 1.2,
                "min_chunk_length": 50,
                "condition_on_previous_chunks": true,
                "early_stop_threshold": 1
              }'
        - lang: bash
          label: Multi Speaker (S2 family only)
          source: |-
            curl --request POST \
              --url https://api.fish.audio/v1/tts \
              --header 'Authorization: Bearer <token>' \
              --header 'Content-Type: application/json' \
              --header 'model: s2.1-pro-free' \
              --data '{
                "text": "<|speaker:0|>Hello!<|speaker:1|>Hi there!",
                "reference_id": ["speaker-a-id", "speaker-b-id"],
                "temperature": 0.7,
                "top_p": 0.7,
                "prosody": {
                  "speed": 1,
                  "volume": 0,
                  "normalize_loudness": true
                },
                "chunk_length": 300,
                "normalize": true,
                "format": "mp3",
                "sample_rate": 44100,
                "mp3_bitrate": 128,
                "latency": "normal",
                "max_new_tokens": 1024,
                "repetition_penalty": 1.2,
                "min_chunk_length": 50,
                "condition_on_previous_chunks": true,
                "early_stop_threshold": 1
              }'
components:
  schemas:
    TTSRequest:
      description: >-
        Request body for text-to-speech synthesis. Supports single-speaker
        synthesis on all compatible TTS models. Multi-speaker dialogue synthesis
        is available with the S2 family (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`)
        and `drama-3-preview`, not `s1`.


        ## Single Speaker

        Provide either `reference_id` (string) pointing to a voice model, or
        `references` (array of ReferenceAudio) for zero-shot cloning.


        ## Multiple Speakers (Dialogue — S2 family and `drama-3-preview`)

        For multi-speaker synthesis, provide:

        - `reference_id`: array of voice model IDs, e.g., ["speaker-0-id",
        "speaker-1-id"]

        - `text`: use speaker tags `<|speaker:0|>`, `<|speaker:1|>`, etc. to
        indicate speaker changes, e.g., "<|speaker:0|>Hello!<|speaker:1|>Hi
        there!"


        Alternatively, for zero-shot multi-speaker:

        - `references`: 2D array where each inner array contains references for
        one speaker

        - `reference_id`: array of identifiers (can be arbitrary strings for
        zero-shot)


        ## Example (Multi-Speaker with Model IDs)

        ```json

        {
          "text": "<|speaker:0|>Good morning!<|speaker:1|>Good morning! How are you?<|speaker:0|>I'm great, thanks!",
          "reference_id": ["model-id-alice", "model-id-bob"]
        }

        ```
      properties:
        text:
          description: Text to convert to speech.
          title: Text
          type: string
        temperature:
          default: 0.7
          description: >-
            Controls expressiveness. Higher is more varied, lower is more
            consistent.
          maximum: 1
          minimum: 0
          title: Temperature
          type: number
        top_p:
          default: 0.7
          description: Controls diversity via nucleus sampling.
          maximum: 1
          minimum: 0
          title: Top P
          type: number
        references:
          anyOf:
            - description: 'Single speaker: array of reference audio samples'
              items:
                $ref: '#/components/schemas/ReferenceAudio'
              type: array
            - description: >-
                Multiple speakers: array of arrays, where each inner array
                contains reference samples for one speaker
              items:
                items:
                  $ref: '#/components/schemas/ReferenceAudio'
                type: array
              type: array
            - type: 'null'
          description: >-
            Inline voice references for zero-shot cloning. Requires MessagePack
            (not JSON). For single speaker, provide an array of ReferenceAudio
            objects. For multiple speakers, provide an array of arrays where
            each inner array contains references for one speaker.
            **Multi-speaker is available with the S2 family (`s2-pro`,
            `s2.1-pro`, `s2.1-pro-free`) and `drama-3-preview`, not `s1`.** The
            speaker index corresponds to the index in reference_id array.
            Example for multi-speaker: [[{audio, text}], [{audio, text}, {audio,
            text}]] for 2 speakers where speaker 1 has 2 reference samples.
          title: References
        reference_id:
          anyOf:
            - description: 'Single speaker: voice model ID string'
              type: string
            - description: 'Multiple speakers: array of voice model IDs, one per speaker'
              items:
                type: string
              type: array
            - type: 'null'
          default: null
          description: >-
            Voice model ID(s) from Fish Audio library or your custom models. For
            single-speaker synthesis, provide a string. For multi-speaker
            synthesis (dialogue), provide an array of model IDs. **Multi-speaker
            is available with the S2 family (`s2-pro`, `s2.1-pro`,
            `s2.1-pro-free`) and `drama-3-preview`, not `s1`.** When using
            multiple speakers, use speaker tags in your text like
            `<|speaker:0|>` and `<|speaker:1|>` to indicate speaker changes.
            Example: `<|speaker:0|>Hello!<|speaker:1|>Hi there!<|speaker:0|>How
            are you?` with `reference_id: ["speaker-a-id", "speaker-b-id"]`.
          title: Reference Id
        prosody:
          anyOf:
            - $ref: '#/components/schemas/ProsodyControl'
            - type: 'null'
          default: null
          description: Speed and volume adjustments for the output.
        chunk_length:
          default: 300
          description: Text segment size for processing.
          maximum: 300
          minimum: 100
          title: Chunk Length
          type: integer
        normalize:
          default: true
          description: >-
            Normalizes text for English and Chinese, improving stability for
            numbers.
          title: Normalize
          type: boolean
        format:
          default: mp3
          description: Output audio format.
          enum:
            - wav
            - pcm
            - mp3
            - opus
          title: Format
          type: string
        sample_rate:
          anyOf:
            - type: integer
            - type: 'null'
          default: null
          description: >-
            Audio sample rate in Hz. When null, uses the format's default (44100
            Hz for most formats, 48000 Hz for opus).
          title: Sample Rate
        mp3_bitrate:
          default: 128
          description: MP3 bitrate in kbps. Only applies when format is mp3.
          enum:
            - 64
            - 128
            - 192
          title: Mp3 Bitrate
          type: integer
        opus_bitrate:
          default: -1000
          description: >-
            Opus bitrate in bps. -1000 for automatic. Only applies when format
            is opus.
          enum:
            - -1000
            - 24000
            - 32000
            - 48000
            - 64000
          title: Opus Bitrate
          type: integer
        latency:
          default: normal
          description: >-
            Latency-quality trade-off. normal: best quality, balanced: reduced
            latency, low: lowest latency.
          enum:
            - low
            - normal
            - balanced
          title: Latency
          type: string
        max_new_tokens:
          default: 1024
          description: Maximum audio tokens to generate per text chunk.
          title: Max New Tokens
          type: integer
        repetition_penalty:
          default: 1.2
          description: >-
            Penalty for repeating audio patterns. Values above 1.0 reduce
            repetition.
          title: Repetition Penalty
          type: number
        min_chunk_length:
          default: 50
          description: Minimum characters before splitting into a new chunk.
          maximum: 100
          minimum: 0
          title: Min Chunk Length
          type: integer
        condition_on_previous_chunks:
          default: true
          description: Use previous audio as context for voice consistency.
          title: Condition On Previous Chunks
          type: boolean
        early_stop_threshold:
          default: 1
          description: Early stopping threshold for batch processing.
          maximum: 1
          minimum: 0
          title: Early Stop Threshold
          type: number
        features:
          default: []
          description: >-
            Optional request-scoped TTS feature flags forwarded verbatim to the
            inference backend. Use ["quality-guard"] to enable the quality guard
            for this synthesis request. Feature availability is determined by
            the inference backend.
          items:
            type: string
          title: Features
          type: array
        pronunciation_dictionary:
          anyOf:
            - description: >-
                Reference form: list of pointers to platform pronunciation
                dictionaries. Each entry identifies a dictionary by `id` and
                `version`; the server resolves the contents from the platform
                service before forwarding them to the inference engine.
              items:
                $ref: '#/components/schemas/PronunciationDictionaryRef'
              maxItems: 3
              type: array
            - description: >-
                Inline form: list of literal pronunciation dictionaries. Each
                dictionary carries an `items` array of `{key, value,
                case_sensitive?}` entries.
              items:
                $ref: '#/components/schemas/PronunciationDictionaryInline'
              maxItems: 3
              type: array
            - type: 'null'
          default: null
          description: >-
            Optional list of up to 3 pronunciation dictionaries to apply during
            synthesis. Provide either references to platform-managed
            dictionaries OR inline literal dictionaries (the two forms are
            mutually exclusive in a single request). The server resolves and
            merges the dictionaries, then forwards the full merged dictionary to
            the inference engine, which performs the substitution. Matching is
            plain substring matching, leftmost-longest, and case-insensitive
            unless an entry sets `case_sensitive`. Missing or unresolvable
            references are silently dropped — the request still succeeds. Use
            `application/json` or `application/msgpack` content-type; nested
            arrays are not representable in `multipart/form-data`.
          title: Pronunciation Dictionary
      required:
        - text
      title: TTSRequest
      type: object
    ReferenceAudio:
      description: >-
        A voice sample with its transcript, used for zero-shot voice cloning.
        The model will attempt to match the voice characteristics from the audio
        sample.
      properties:
        audio:
          description: >-
            Raw audio bytes of the voice sample. Supported formats: WAV, MP3,
            FLAC. For best results, use 10-30 seconds of clear speech with
            minimal background noise.
          format: binary
          title: Audio
          type: string
        text:
          description: >-
            The exact transcript of what is spoken in the audio sample. Accuracy
            is important for voice cloning quality.
          title: Text
          type: string
      required:
        - audio
        - text
      title: ReferenceAudio
      type: object
    ProsodyControl:
      description: >-
        Controls for adjusting the prosody (rhythm and intonation) of generated
        speech.
      properties:
        speed:
          default: 1
          description: >-
            Speaking rate multiplier. Valid range: 0.5 to 2.0. 1.0 = normal
            speed, 0.5 = half speed, 2.0 = double speed. Useful for adjusting
            pacing without regenerating audio.
          title: Speed
          type: number
        volume:
          default: 0
          description: >-
            Volume adjustment in decibels (dB). 0 = no change, positive values =
            louder, negative values = quieter.
          title: Volume
          type: number
        normalize_loudness:
          default: true
          description: >-
            Normalize output loudness for more consistent perceived volume.
            Applies to the S2 family (`s2-pro`, `s2.1-pro`, `s2.1-pro-free`); on
            `s1` it is accepted but has no effect.
          title: Normalize Loudness
          type: boolean
      title: ProsodyControl
      type: object
    PronunciationDictionaryRef:
      additionalProperties: false
      description: >-
        Reference to a server-managed pronunciation dictionary. The server
        resolves contents via the platform pronunciation-dictionaries API and
        forwards the full merged dictionary to the inference engine, which
        performs the substitution.
      properties:
        id:
          description: Dictionary identifier as registered on the platform.
          pattern: ^[A-Za-z0-9_-]{1,128}$
          title: Id
          type: string
        version:
          description: >-
            Immutable version identifier for the dictionary. Version is required
            — there is no implicit `latest`.
          pattern: ^[A-Za-z0-9_-]{1,128}$
          title: Version
          type: string
      required:
        - id
        - version
      title: PronunciationDictionaryRef
      type: object
    PronunciationDictionaryInline:
      additionalProperties: false
      description: >-
        Inline literal pronunciation dictionary. The server forwards the entries
        directly to the inference engine without contacting the platform.
      properties:
        items:
          description: >-
            Replacement entries for this dictionary. See the top-level
            `pronunciation_dictionary` field description for replacement
            semantics.
          items:
            $ref: '#/components/schemas/PronunciationItem'
          maxItems: 5000
          title: Items
          type: array
      required:
        - items
      title: PronunciationDictionaryInline
      type: object
    PronunciationItem:
      additionalProperties: false
      description: >-
        A single key/value entry in a pronunciation dictionary. The inference
        engine replaces every occurrence of `key` in the request text with the
        phoneme form `value` during synthesis.
      properties:
        key:
          description: >-
            Source substring to match. Pure substring match — no tokenization,
            no regex. Overlapping matches resolve leftmost-longest. For CJK text
            include enough context to disambiguate.
          maxLength: 256
          minLength: 1
          title: Key
          type: string
        value:
          description: >-
            Phonetic representation that replaces the key during synthesis.
            Dictionary authors should NOT include the `<|phoneme_start|>` /
            `<|phoneme_end|>` markers themselves; the inference engine wraps the
            value with those markers internally so the body is treated as
            phonemes rather than orthographic text. Requests whose key or value
            contain either marker are rejected.
          maxLength: 1024
          minLength: 1
          title: Value
          type: string
        case_sensitive:
          default: false
          description: >-
            When true the match is case-sensitive; when false ASCII case folding
            is applied.
          title: Case Sensitive
          type: boolean
      required:
        - key
        - value
      title: PronunciationItem
      type: object
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer

````