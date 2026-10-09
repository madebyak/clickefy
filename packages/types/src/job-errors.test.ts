import { describe, expect, it } from 'vitest';

import {
  JOB_ERROR_REASONS,
  explainProviderError,
  isJobErrorReason,
  jobErrorMessage,
  jobErrorReasonFor,
} from './job-errors';
import { detectVideoTaskIntent } from './video-task-intent';

/** Seedance content[]: prompt first, then the attachments in order. */
const label = (i: number) => ['', 'Image 1', 'Image 2', 'Video 1'][i];

describe('explainProviderError', () => {
  it('recognises Seedance task-type failures (async, after queueing)', () => {
    expect(
      jobErrorReasonFor('Seedance task failed (InvalidParameter.TaskTypeMismatch): the task type does not match'),
    ).toBe('video_task_mismatch');
    expect(
      jobErrorReasonFor('Seedance task failed (InvalidParameter.TaskTypeConstraint): ratio must be adaptive'),
    ).toBe('video_task_mismatch');
  });

  it('recognises the real-person privacy rejection and names the attachment', () => {
    const e = explainProviderError(
      'Seedance API 400 Bad Request: {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image \'content[2]\' may contain real person."}}',
      label,
    );
    expect(e).toEqual({ reason: 'input_real_person', params: { item: 'Image 2', kind: 'image' } });
    expect(jobErrorReasonFor('code InputVideoSensitiveContentDetected.PrivacyInformation')).toBe(
      'input_real_person',
    );
  });

  it('reads the measured size and the limit out of a Seedance dimension rejection', () => {
    const small = explainProviderError(
      'Seedance API 400 Bad Request: {"error":{"code":"InvalidParameter","message":"Error while downloading image, error: expected the width to be at least 300px, but received a 280x602px image instead Request id: 0217"}}',
    );
    expect(small).toEqual({
      reason: 'input_media_too_small',
      params: { item: undefined, kind: 'image', side: 'width', value: 280, min: 300 },
    });
    expect(jobErrorMessage(small!.reason, small!.params)).toBe(
      'Image width of 280 pixels is too low. Minimum width is 300 pixels.',
    );
    const large = explainProviderError(
      'expected the width to be at most 6000px, but received a 6048x2592px image instead',
    );
    expect(large?.reason).toBe('input_media_too_large');
    expect(large?.params).toMatchObject({ side: 'width', value: 6048, max: 6000 });
    const px = explainProviderError(
      'The parameter `content[1]` specified in the request is not valid: the parameter image pixel count specified in the request must be greater than or equal to 90000 for model dreamina-seedance-2-5 in r2v',
      label,
    );
    expect(px).toEqual({ reason: 'input_media_too_small', params: { item: 'Image 1', kind: 'image', min: 300 } });
    expect(jobErrorMessage(px!.reason, px!.params)).toBe('Image 1 is too small. Minimum size is 300×300 pixels.');
  });

  it('recognises shape, clip length and upscaler source rejections', () => {
    expect(
      explainProviderError(
        'expected the aspect ratio to be between 0.39 and 2.50, but received image with aspect ratio: 2.94 instead',
      ),
    ).toEqual({ reason: 'input_media_bad_shape', params: { item: undefined, kind: 'image', min: 0.39, max: 2.5, value: 2.94 } });
    expect(
      explainProviderError(
        'the parameter video total duration (seconds) specified in the request must be less than or equal to 15',
      ),
    ).toEqual({ reason: 'input_video_too_long', params: { kind: 'video', max: 15 } });
    expect(
      explainProviderError(
        'fal 422 https://queue.fal.run/fal-ai/bytedance-upscaler/requests/<id>: {"detail":[{"msg":"The input video must have one side of length less than 1080 pixels for 1080p upscale"}]}',
      ),
    ).toEqual({ reason: 'input_upscale_source_too_large', params: { kind: 'video', max: 1080 } });
  });

  it('separates copyright from safety on outputs, and the Gemini recitation stop', () => {
    expect(
      explainProviderError(
        'Seedance task failed (OutputAudioSensitiveContentDetected.PolicyViolation): The request failed because the output audio may be related to copyright restrictions.',
      ),
    ).toEqual({ reason: 'output_copyright', params: { kind: 'audio' } });
    expect(
      explainProviderError('Seedance task failed (OutputVideoSensitiveContentDetected): may contain sensitive information'),
    ).toEqual({ reason: 'output_flagged', params: { kind: 'video' } });
    expect(explainProviderError('OpenAI request failed (moderation_blocked): Your request was rejected by the safety system.')?.reason).toBe(
      'output_flagged',
    );
    expect(explainProviderError('Gemini returned no images. The model may have filtered the output (IMAGE_RECITATION).')?.reason).toBe(
      'output_copyright',
    );
    expect(explainProviderError('Gemini returned no images. The model may have filtered the output.')?.reason).toBe('output_empty');
  });

  it('files overloads under busy and our own mistakes under system', () => {
    expect(explainProviderError('{"error":{"code":503,"message":"This model is currently experiencing high demand."}}')?.reason).toBe('provider_busy');
    expect(explainProviderError('Connection terminated unexpectedly')?.reason).toBe('provider_busy');
    expect(explainProviderError('Seedance API 403 Forbidden: {"error":{"code":"AccountOverdueError"}}')?.reason).toBe('system');
    expect(explainProviderError('Kling API 2.0 error code=1201 message=model/resolution(kling-v2-6/720p) is not supported with last frame')?.reason).toBe('system');
    expect(explainProviderError('Seedance task failed (InvalidParameter): Invalid video_url.')?.reason).toBe('system');
  });

  it('leaves the truly unknown unexplained', () => {
    expect(jobErrorReasonFor('Seedance API 500 Internal Server Error')).toBeUndefined();
    expect(jobErrorReasonFor('Kling task abc failed: no reason supplied')).toBeUndefined();
  });

  it('has a message for every reason', () => {
    for (const reason of JOB_ERROR_REASONS) {
      expect(isJobErrorReason(reason)).toBe(true);
      expect(jobErrorMessage(reason).length).toBeGreaterThan(20);
    }
    expect(isJobErrorReason('provider_error')).toBe(false);
  });
});

describe('detectVideoTaskIntent', () => {
  it('spots edit prompts', () => {
    expect(detectVideoTaskIntent('Replace the cat in @Video1 with a dog')).toBe('edit');
    expect(detectVideoTaskIntent('remove the logo from the corner')).toBe('edit');
    expect(detectVideoTaskIntent('Add a red balloon to the video')).toBe('edit');
  });

  it('spots extend prompts', () => {
    expect(detectVideoTaskIntent('Continue the story for another few seconds')).toBe('extend');
    expect(detectVideoTaskIntent('extend the clip backward')).toBe('extend');
  });

  it('leaves ordinary reference prompts alone', () => {
    expect(detectVideoTaskIntent('A woman walking on a beach at sunset, cinematic')).toBeNull();
    expect(detectVideoTaskIntent('Add dramatic lighting and slow motion')).toBeNull();
    expect(detectVideoTaskIntent('Use the motion from @Video1 for a new dancer')).toBeNull();
    expect(detectVideoTaskIntent('   ')).toBeNull();
  });

  it('takes whichever intent the sentence leads with', () => {
    expect(detectVideoTaskIntent('Continue the scene, then remove the car')).toBe('extend');
    expect(detectVideoTaskIntent('Remove the car, then continue the scene')).toBe('edit');
  });

  it('understands Arabic, including the و prefix and alef/diacritic variants', () => {
    expect(detectVideoTaskIntent('استبدل القطة في الفيديو بكلب')).toBe('edit');
    expect(detectVideoTaskIntent('واحذف الشعار من الزاوية')).toBe('edit');
    expect(detectVideoTaskIntent('أكمل القصة لبضع ثوانٍ')).toBe('extend');
    expect(detectVideoTaskIntent('امرأة تمشي على الشاطئ عند الغروب')).toBeNull();
    // غير means "change" but also "other"/"not" — deliberately ignored.
    expect(detectVideoTaskIntent('مشهد غير واقعي بألوان زاهية')).toBeNull();
  });
});
