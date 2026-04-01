Below is a **detailed V1 PRD for Clickefy Admin Dashboard**, built around your latest clarification:

**end users get a very simple flow**
browse template → tap **Use this template** → upload required image(s) if needed → optionally choose aspect ratio only if admin enabled it → tap **Run** → receive result.

Everything complex stays in the admin side.

A few technical facts shape this PRD: Gemini’s current image APIs expose `aspectRatio` and `imageSize`, with supported aspect ratios including `1:1`, `4:5`, `9:16`, `16:9`, `21:9` and others; if `aspectRatio` is omitted, the model chooses a default, often influenced by reference images. Google’s current image docs also position Gemini 3 Pro Image Preview for more advanced professional asset generation, and Gemini 3.1 Flash Image Preview adds newer ratios and more resolution options. Google’s newer Interactions API covers multimodal/video scenarios but is still in early beta. On the Kling side, the current API/docs surface image-to-video with start/end-image style inputs (`image` / `image_tail`), input constraints, and product-level support for longer generation and storyboard/scene-transition capabilities. ([Google AI for Developers][1])

---

# Clickefy Admin Dashboard PRD

**Version:** V1
**Platform:** Web admin dashboard
**Managed app:** React Native mobile app for iOS + Android
**Primary AI providers in V1:** Gemini for image generation, Kling for video generation
**Template philosophy:** locked generation recipes managed by admins, minimal user interaction

---

## 1. Product summary

Clickefy is a template-based AI content generation app for brands and product owners.

The end user does not write prompts, tune quality, or configure technical AI settings. Instead, they select a ready-made template and provide only the minimum required input, usually one or more product images. The admin dashboard is where the real work happens: content setup, prompt engineering, reference control, provider settings, testing, publishing, and template quality management.

### Core principle

**Admins build the intelligence. Users only trigger it.**

---

## 2. Problem statement

Most product owners, merchants, and social media teams want polished AI-generated visuals for their products, but they do not know how to:

* write strong prompts
* choose the correct model
* manage reference images
* control output consistency
* set the right aspect ratios and technical settings
* test multiple generation workflows

At the same time, giving end users too many controls ruins simplicity and increases failure rates.

Clickefy solves this by letting admins pre-build powerful content recipes as locked templates, while the mobile app reduces the user action to a few taps.

---

## 3. Product goals

### Primary goals

* Let admins create and manage generation templates for product visuals.
* Keep the end-user flow extremely simple.
* Support templates that generate:

  * image only
  * video only
  * image then video
* Allow admins to decide whether aspect ratio is exposed to users.
* Support templates that require one or multiple user-uploaded images.
* Make model-specific settings dynamic based on provider/model capability.
* Let admins test templates before publishing.
* Let admins manage previews, publishing, and quality.

### Secondary goals

* Build a scalable structure that can support more providers later.
* Track template performance and generation failures.
* Keep the authoring experience structured, not chaotic.

---

## 4. Non-goals for V1

These should stay out of V1:

* No free-form prompt editing by end users.
* No node-based visual workflow builder.
* No advanced multi-step branching logic.
* No collaborative admin editing.
* No automated A/B testing.
* No public creator marketplace.
* No custom user-defined templates.
* No complex per-user provider selection.

---

## 5. User types

### A. Admin

The person creating and managing templates.

Responsibilities:

* define template content
* attach references
* configure generation settings
* test outputs
* publish or archive templates
* control what the end user is allowed to see or choose

### B. End user

The person using the mobile app to generate visuals.

Responsibilities:

* browse templates
* upload required image(s)
* optionally pick one very limited option such as aspect ratio
* run the template
* receive result

---

## 6. V1 assumptions

This PRD assumes the following:

1. The app is template-driven, not prompt-driven.
2. Templates are created only by admins.
3. The end user sees only a limited interaction layer.
4. Aspect ratio options are read from provider/model capability and not manually hardcoded long term. Gemini already documents supported aspect ratios and image-size fields, so the dashboard should be capability-aware rather than static. ([Google AI for Developers][1])
5. V1 supports structured authoring, not node orchestration.
6. A template may produce image-only, video-only, or image→video outputs, but the admin UI should still feel like one structured recipe editor rather than a generic workflow engine.

---

## 7. High-level product architecture

There are three layers:

### Layer 1: Template content layer

What appears in the mobile app:

* title
* thumbnail
* preview gallery
* category
* description
* featured state

### Layer 2: User interaction layer

What the end user is asked to do:

* upload one or more product images
* optionally choose aspect ratio
* tap run

### Layer 3: Generation engine layer

Hidden admin-controlled logic:

* provider
* model
* reference assets
* prompt
* internal rules
* output rules
* fallback behavior
* testing and publish state

---

## 8. End-user experience definition

### Main mobile flow

1. User opens app
2. User views homepage with template collections
3. User taps a template
4. User taps **Use this template**
5. If template requires uploads, app asks for them
6. If admin enabled aspect ratio selector, app shows available options
7. User taps **Run**
8. Job is processed
9. User receives final result

### End-user constraints

The user should not see:

* raw prompts
* provider names unless product strategy requires it
* quality sliders
* motion controls
* seed
* generation count
* hidden references
* negative prompts
* technical parameters

---

## 9. Supported template modes in V1

### Mode 1: Image only

Input: zero, one, or multiple images
Output: one or more final images

Example:
Upload product → generate premium skincare still life

### Mode 2: Video only

Input: one or multiple images
Output: final video

Example:
Upload product image → animate short promo clip

### Mode 3: Image then video

Input: one or multiple images
Output: image first, then video generated from the image pipeline

Example:
Upload product → generate hero image → animate it into short video

Important: although this is technically sequential, the authoring experience remains a structured form, not a general-purpose workflow graph.

---

## 10. Admin dashboard information architecture

### Main sections

1. Dashboard
2. Templates
3. Template Editor
4. Asset Library
5. Providers & Models
6. Jobs / Runs
7. Categories & Tags
8. Analytics
9. Settings

---

# 11. Detailed requirements by section

## 11.1 Dashboard

### Purpose

Give admins a quick operational overview.

### Required widgets

* total templates
* published templates
* draft templates
* archived templates
* generation count today / week / month
* success rate
* failed runs
* average generation time
* top-performing templates
* most failed templates
* provider usage split
* pending jobs
* recently edited templates

### Admin actions from dashboard

* create new template
* review failed jobs
* open drafts
* open top-performing template
* filter recent activity

---

## 11.2 Templates list page

### Purpose

Manage all templates in one place.

### List columns

* thumbnail
* template title
* type
* category
* status
* featured
* last updated
* last tested
* success rate
* average runtime
* publish state

### Filters

* type: image / video / image+video
* category
* status
* featured
* provider
* recently updated
* high failure rate
* unpublished
* premium-only if added later

### Actions

* create template
* edit
* duplicate
* archive
* publish / unpublish
* feature / unfeature
* preview
* test
* delete draft

---

## 11.3 Template editor

This is the core V1 screen.

The editor should be tab-based.

### Tabs

1. Basic Info
2. User Input
3. Generation Setup
4. Output Settings
5. Test Run
6. Publish

---

## 11.3.1 Basic Info tab

### Purpose

Define how the template appears in the app.

### Fields

* Template title
* Internal slug
* Short description
* Long description
* Cover thumbnail
* Preview gallery
* Category
* Tags / keywords
* Template type:

  * image only
  * video only
  * image + video
* Featured toggle
* Status:

  * draft
  * published
  * archived
* Sort order / ranking priority

### Validation

* title required
* category required
* template type required
* cover image required before publish
* at least one preview required before publish

---

## 11.3.2 User Input tab

### Purpose

Control exactly what the end user sees after tapping **Use this template**.

### Section A: Input requirements

Admin chooses:

* no upload needed
* single required image
* multiple required images
* single required + optional extra image
* multiple required + optional extra image

### For each upload field

Admin configures:

* field name
* field label shown to user
* helper text
* required or optional
* accepted file types
* minimum file resolution
* maximum file size
* max image count
* recommended background type
* crop or fit behavior
* order importance

### Example fields

* Product image
* Side angle image
* Packaging detail image
* Label close-up
* Lifestyle reference image

### Section B: User-visible options

These are strict admin toggles.

#### Aspect ratio selector

* enabled: yes/no
* options source: dynamic from chosen model/provider
* default selected value
* whether user must choose or default applies automatically

This requirement should be model-driven, because Gemini already supports a documented set of aspect ratios and image sizes, and the system should follow the active model capability rather than a hardcoded list. ([Google AI for Developers][1])

### Section C: UX copy

* run button label
* upload screen title
* upload helper text
* processing message
* success message
* failure message

### V1 rule

Only aspect ratio may be optionally shown as a user control. Everything else remains hidden.

---

## 11.3.3 Generation Setup tab

### Purpose

Define the hidden generation recipe.

This tab is admin-only.

### Section A: Generation mode

* image only
* video only
* image then video

### Section B: Provider and model

For each generation stage, admin selects:

* provider
* model
* action type

Example:

* Stage 1: Gemini → image generation
* Stage 2: Kling → image-to-video

### Section C: Prompt architecture

Do not use one single raw prompt field only.

Use structured prompt sections:

* creative goal
* composition instructions
* lighting instructions
* product preservation rules
* background instructions
* styling rules
* negative rules
* hidden system instructions

The system may compile these into one final prompt payload at runtime, but the admin UI should stay structured.

### Section D: Input mapping

Map user-uploaded fields into the recipe.

Example:

* product_image → hero product reference
* label_closeup → text preservation reference
* side_angle → secondary structural reference

### Section E: Internal references

Attach admin-only references:

* inspiration image
* composition reference
* lighting reference
* style reference
* approved sample output
* video start image
* video end image

### Section F: Provider-specific dynamic config

This panel changes based on selected provider/model.

For Gemini image generation:

* aspect ratio
* image size / resolution class
* number of outputs
* reference handling mode
* fallback image model

Google’s current docs explicitly expose `aspectRatio` and `imageSize`, with supported image sizes such as `512`, `1K`, `2K`, and `4K`, and note that Gemini 3 Pro Image Preview is positioned for more advanced professional asset creation. ([Google AI for Developers][1])

For Kling video generation:

* source image mapping
* optional start/end image mapping
* duration if supported by chosen model
* aspect ratio if supported
* motion prompt
* fallback behavior

Kling’s current docs/search snippets show image-to-video support with image inputs, input constraints, and broader product support for scene transitions/storyboarding and durations up to 15 seconds in newer video modes. ([Kling AI][2])

### Section G: Fallback and retry

* retry on fail: yes/no
* number of retries
* fallback model
* fallback output type behavior
* notify admin on repeated failure

---

## 11.3.4 Output Settings tab

### Purpose

Define what final result the user receives.

### Fields

* output type:

  * image
  * video
  * image + video
* output count
* output format
* output resolution target
* background behavior
* watermark behavior if applicable
* save to user library yes/no
* allow download yes/no
* allow regeneration yes/no

### Product decision for V1

Keep output count low:

* 1 final result, or
* max 2 results

Too many outputs weaken the “one-tap premium result” promise.

---

## 11.3.5 Test Run tab

### Purpose

Allow admins to validate template quality before publishing.

### Required features

* upload sample user input(s)
* choose any enabled user-visible options
* run generation
* show output preview
* show runtime
* show provider/model used
* show request payload summary
* show error state if failed
* save successful result to preview gallery
* mark template as tested

### Strong requirement

A template should not be publishable before at least one successful test run.

---

## 11.3.6 Publish tab

### Purpose

Control release state and storefront placement.

### Fields

* status:

  * draft
  * published
  * archived
* featured toggle
* category placement
* sort priority
* visibility:

  * all users
  * premium only
  * internal only
* publish notes
* last published by
* publish timestamp

---

## 11.4 Asset Library

### Purpose

Store and reuse all assets related to templates.

### Asset types

* thumbnail
* preview image
* inspiration image
* composition reference
* lighting reference
* start frame
* end frame
* approved output
* fallback reference

### Metadata

* asset name
* asset type
* linked template(s)
* tags
* source note
* visibility:

  * internal only
  * app preview
  * generation reference
* upload date
* resolution
* orientation

### Actions

* upload
* tag
* link to template
* duplicate
* archive
* delete unused draft asset

---

## 11.5 Providers & Models

### Purpose

Centralize provider/model capability management.

### Why this matters

The admin UI should not hardcode technical options forever. It should read provider/model capability definitions and render the correct controls.

### Page content

* provider list
* active status
* API connection health
* enabled models
* model status:

  * active
  * deprecated
  * beta / preview
* capability map
* default fallback model
* cost configuration
* timeout configuration

### Required capability fields

For each model:

* supported output types
* supported aspect ratios
* supported image sizes
* supported durations
* accepts single image input yes/no
* accepts multiple image inputs yes/no
* supports start/end image yes/no
* supports text prompt yes/no
* supports style reference yes/no
* max upload size
* max input count
* recommended template use cases

This approach is especially important because Gemini image/video surfaces are changing quickly and some newer multimodal APIs are explicitly still in beta. ([Google AI for Developers][3])

---

## 11.6 Jobs / Runs page

### Purpose

Inspect every generation attempt.

### Fields per job

* job id
* template used
* user id
* template version
* start time
* end time
* duration
* provider
* model
* input summary
* output summary
* status:

  * queued
  * running
  * success
  * failed
* failure reason
* retry count
* cost estimate
* aspect ratio used

### Actions

* inspect logs
* inspect payload summary
* inspect final output
* retry manually
* mark issue
* disable template from here if severe failure spikes happen

---

## 11.7 Categories & Tags

### Purpose

Organize browsing.

### Required

* create/edit categories
* parent-child hierarchy optional
* category image optional
* sort order
* SEO/search keywords
* tag management
* template count per category

### Suggested default categories

* skincare
* beauty
* food & beverage
* supplements
* fashion accessories
* jewelry
* perfume
* electronics
* home products

---

## 11.8 Analytics

### Purpose

Track business and quality performance.

### Per-template metrics

* template views
* use button taps
* upload start rate
* completion rate
* generation success rate
* regeneration rate
* average runtime
* average cost
* output save rate
* output download rate
* failure rate
* most common failure reason

### Dashboard-level metrics

* best-performing categories
* best-performing aspect ratios
* provider success rate comparison
* top templates by usage
* top templates by conversion
* lowest-quality templates by failure rate

---

## 11.9 Settings

### Purpose

Admin-wide system controls.

### Suggested settings

* API credentials
* provider enable/disable
* default retry limits
* default upload limits
* moderation settings
* storage settings
* notification settings
* template publish rules
* app homepage configuration

---

# 12. Functional requirements

## FR-1 Template creation

Admin must be able to create a new template draft.

## FR-2 Template editing

Admin must be able to edit all template metadata and generation settings.

## FR-3 Upload schema

Admin must be able to define whether the user needs zero, one, or multiple images.

## FR-4 User-visible option toggle

Admin must be able to enable or disable aspect ratio selection for the end user.

## FR-5 Dynamic aspect ratio population

If aspect ratio is enabled, available options should be derived from the selected model/provider capability, not manually retyped. Gemini’s image APIs document supported aspect ratio values directly, making this behavior appropriate for V1. ([Google AI for Developers][1])

## FR-6 Structured recipe setup

Admin must be able to configure prompts and references as structured fields.

## FR-7 Internal reference support

Admin must be able to attach hidden reference assets.

## FR-8 Provider-specific config

Admin must be able to configure model settings relevant to the chosen provider/model.

## FR-9 Test run

Admin must be able to test any template draft with sample inputs.

## FR-10 Publish control

Admin must be able to publish, unpublish, archive, and feature templates.

## FR-11 Version snapshot

Every publish action should create a version snapshot.

## FR-12 Job inspection

Admin must be able to view template run logs.

## FR-13 Duplicate template

Admin must be able to clone an existing template.

## FR-14 Failure handling

System must support retries and fallback behavior when configured.

---

# 13. Non-functional requirements

### Performance

* Template list should load quickly even with many items.
* Job logs should be filterable and paginated.
* Test runs should show clear progress state.

### Reliability

* Failed generations must not silently disappear.
* Every generation job must be persisted with status.

### Scalability

* Provider capability mapping must support adding new models later.
* Template structure must support more outputs/providers without redesign.

### Security

* Only admins can access dashboard.
* Reference assets and hidden prompts must not leak into mobile client payloads unless intended.

### Maintainability

* Template data should be versioned.
* Provider capability configuration should be centralized.

---

# 14. Recommended data model

A practical V1 schema:

### templates

* id
* title
* slug
* short_description
* long_description
* category_id
* type
* status
* featured
* sort_order
* cover_asset_id
* created_at
* updated_at

### template_versions

* id
* template_id
* version_number
* snapshot_json
* created_by
* created_at
* publish_note

### template_inputs

* id
* template_id
* field_key
* field_type
* label
* helper_text
* required
* order_index
* accepts_multiple
* file_constraints_json

### template_user_options

* id
* template_id
* option_key
* enabled
* config_json

### template_generation_configs

* id
* template_id
* stage_order
* provider
* model
* action_type
* prompt_sections_json
* input_mapping_json
* provider_config_json
* fallback_config_json

### template_assets

* id
* template_id
* asset_type
* usage_role
* visibility
* file_url
* metadata_json

### categories

* id
* name
* slug
* sort_order

### provider_models

* id
* provider
* model_key
* status
* capabilities_json

### generation_jobs

* id
* user_id
* template_id
* template_version_id
* status
* input_json
* option_json
* output_json
* error_json
* runtime_ms
* created_at

---

# 15. Versioning rules

Versioning is important because prompt logic and provider behavior will evolve.

### Rules

* Every published template gets a version snapshot.
* Editing a published template creates a draft state until republished.
* Jobs should reference the exact template version used.
* Admin should be able to compare current draft vs last published version later, even if V1 only stores snapshots.

---

# 16. Validation and publish rules

A template may be published only if:

* title exists
* category exists
* template type selected
* cover thumbnail exists
* at least one preview exists
* required input schema is valid
* generation config is complete
* at least one successful test run exists

---

# 17. Suggested admin UX behavior

### Create template flow

1. Admin clicks **Create Template**
2. Fills Basic Info
3. Defines User Input schema
4. Configures Generation Setup
5. Adds references
6. Runs test
7. Saves test output as preview
8. Publishes

### Duplicate template flow

1. Admin opens existing template
2. Clicks **Duplicate**
3. New draft is created with copied config
4. Admin changes copy details
5. Tests and publishes

### Archive flow

1. Admin archives template
2. Template disappears from app listing
3. Old jobs remain available in logs

---

# 18. Edge cases

### Case 1: Missing required user upload

App blocks run and shows clear upload requirement message.

### Case 2: Model no longer supports a config

Admin dashboard should flag the config as invalid and require update before publish.

### Case 3: Provider timeout

Job marked failed or retried based on template retry config.

### Case 4: Upload type mismatch

User sees validation message before run.

### Case 5: Hidden reference deleted

Template enters warning state and cannot publish until fixed.

### Case 6: Aspect ratio enabled but provider has no compatible values

Aspect ratio toggle should auto-disable or show admin warning.

### Case 7: Image→video template passes stage one but stage two fails

Job should store partial success and clear failure reason.

---

# 19. Analytics events

Recommended event tracking:

### Admin events

* template_created
* template_edited
* template_test_run_started
* template_test_run_succeeded
* template_test_run_failed
* template_published
* template_archived
* template_duplicated

### End-user events

* template_viewed
* use_template_clicked
* upload_started
* upload_completed
* aspect_ratio_selected
* run_clicked
* generation_succeeded
* generation_failed
* output_saved
* output_downloaded
* regenerate_clicked

---

# 20. Permissions model for V1

### Super Admin

* full access
* provider settings
* publish rights
* delete/archive rights

### Content Admin

* create/edit templates
* upload assets
* test templates
* publish if allowed

### Reviewer optional later

* inspect tests
* approve before publish

For V1, Super Admin + Content Admin is enough.

---

# 21. Technical implementation recommendation

### Frontend

* web-based admin dashboard
* structured forms, not visual workflow canvas
* dynamic model-capability-driven field rendering

### Backend

* template CRUD
* version snapshots
* provider capability registry
* generation job queue
* asset storage
* test-run endpoint
* analytics events

### Capability registry

This is a key system object.

Instead of hardcoding:

* aspect ratios
* image sizes
* duration options
* whether start/end frame is available

store them per model in a registry, and render the admin UI accordingly.

This is especially appropriate because Gemini’s image config is explicitly parameterized in docs, and some broader multimodal/video surfaces are still evolving. ([Google AI for Developers][1])

---

# 22. Suggested MVP release scope

### Must-have

* admin auth
* templates list
* create/edit template
* structured user input config
* structured generation config
* reference asset support
* aspect ratio toggle
* dynamic provider capability reading
* test run
* publish/unpublish
* jobs log
* basic analytics

### Nice-to-have but can wait

* template duplication
* archive flow
* advanced analytics dashboards
* multi-role approval workflow
* reusable prompt blocks
* bulk asset tagging

---

# 23. Success criteria for V1

Clickefy V1 succeeds if:

* admins can create templates without engineering help
* end users can generate content in 2–3 actions
* publish quality is controlled through testing
* templates stay stable even when provider settings differ
* failure reasons are visible and actionable
* best templates become obvious through analytics

---

# 24. Final product direction

The most important positioning decision is this:

**Clickefy is not an AI creation playground.**
It is a **managed template engine for product content generation**.

That means the admin dashboard should optimize for:

* repeatability
* control
* quality
* minimal end-user decisions

Not for freedom, not for experimentation, and not for exposing AI complexity.

---

# 25. Recommended next deliverables

The clean next step after this PRD is:

1. **Admin dashboard sitemap**
2. **page-by-page UX wireframe structure**
3. **database schema**
4. **API endpoint spec**
5. **mobile-side template detail page spec**

I can turn this PRD next into a **full UX sitemap and screen-by-screen admin dashboard structure** in product-designer format.

[1]: https://ai.google.dev/api/generate-content "Generating content  |  Gemini API  |  Google AI for Developers"
[2]: https://kling.ai/document-api/apiReference/model/imageToVideo?utm_source=chatgpt.com "Next-Gen AI Video & AI Image Generator - Kling AI"
[3]: https://ai.google.dev/gemini-api/docs/interactions "Interactions API  |  Gemini API  |  Google AI for Developers"
