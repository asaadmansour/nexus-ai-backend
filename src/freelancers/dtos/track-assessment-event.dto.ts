import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export const ASSESSMENT_EVENT_TYPES = [
  'fullscreen_enter',
  'fullscreen_exit',
  'focus_lost',
  'focus_returned',
  'visibility_hidden',
  'visibility_visible',
  'copy_attempt',
  'paste_attempt',
  'timer_expired',
  'manual_submit_click',
  'autosave_failed',
] as const;

export type AssessmentEventType = (typeof ASSESSMENT_EVENT_TYPES)[number];

export class TrackAssessmentEventDto {
  @IsString()
  @IsIn(ASSESSMENT_EVENT_TYPES)
  eventType!: AssessmentEventType;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
