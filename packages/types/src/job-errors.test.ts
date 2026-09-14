import { describe, expect, it } from 'vitest';

import { JOB_ERROR_MESSAGES, isJobErrorReason, jobErrorReasonFor } from './job-errors';
import { detectVideoTaskIntent } from './video-task-intent';

describe('jobErrorReasonFor', () => {
  it('recognises Seedance task-type failures (async, after queueing)', () => {
    expect(
      jobErrorReasonFor('Seedance task failed (InvalidParameter.TaskTypeMismatch): the task type does not match'),
    ).toBe('video_task_mismatch');
    expect(
      jobErrorReasonFor('Seedance task failed (InvalidParameter.TaskTypeConstraint): ratio must be adaptive'),
    ).toBe('video_task_mismatch');
  });

  it('recognises the real-person privacy rejection, image or video', () => {
    // Verbatim shape of every failed Seedance job in production.
    expect(
      jobErrorReasonFor(
        'Seedance API 400 Bad Request: {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image co',
      ),
    ).toBe('input_real_person');
    expect(jobErrorReasonFor('code InputVideoSensitiveContentDetected.PrivacyInformation')).toBe(
      'input_real_person',
    );
  });

  it('leaves everything else unexplained', () => {
    expect(jobErrorReasonFor('Seedance API 500 Internal Server Error')).toBeUndefined();
    expect(jobErrorReasonFor('Kling task abc failed: no reason supplied')).toBeUndefined();
  });

  it('has a message for every reason', () => {
    for (const reason of ['video_task_mismatch', 'input_real_person'] as const) {
      expect(isJobErrorReason(reason)).toBe(true);
      expect(JOB_ERROR_MESSAGES[reason].length).toBeGreaterThan(20);
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
