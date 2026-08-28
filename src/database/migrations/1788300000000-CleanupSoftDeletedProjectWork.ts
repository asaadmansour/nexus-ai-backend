import { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanupSoftDeletedProjectWork1788300000000 implements MigrationInterface {
  name = 'CleanupSoftDeletedProjectWork1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE project_invitations invitation
      SET status = 'cancelled',
          responded_at = COALESCE(invitation.responded_at, NOW()),
          response_reason = COALESCE(
            invitation.response_reason,
            'Project was deleted by the customer'
          )
      FROM projects project
      WHERE invitation.project_id = project.id
        AND project.deleted_at IS NOT NULL
        AND invitation.status IN ('pending', 'accepting')
    `);
    await queryRunner.query(`
      UPDATE project_role_assignments assignment
      SET status = 'cancelled',
          ended_at = COALESCE(assignment.ended_at, NOW()),
          decision_reason = COALESCE(
            assignment.decision_reason,
            'Project was deleted by the customer'
          )
      FROM projects project
      WHERE assignment.project_id = project.id
        AND project.deleted_at IS NOT NULL
        AND assignment.status IN ('assigned', 'accepted', 'in_progress', 'completed')
    `);
    await queryRunner.query(`
      UPDATE project_tasks task
      SET status = 'cancelled',
          assignment_status = 'unassigned',
          assigned_freelancer_profile_id = NULL
      FROM projects project
      WHERE task.project_id = project.id
        AND project.deleted_at IS NOT NULL
        AND task.status != 'cancelled'
    `);
    await queryRunner.query(`
      UPDATE matching_runs run
      SET status = 'failed',
          error = COALESCE(run.error, 'Project was deleted by the customer'),
          completed_at = COALESCE(run.completed_at, NOW())
      FROM projects project
      WHERE run.project_id = project.id
        AND project.deleted_at IS NOT NULL
        AND run.status IN ('queued', 'running')
    `);
    await queryRunner.query(`
      DELETE FROM notifications notification
      USING projects project
      WHERE notification.project_id = project.id
        AND project.deleted_at IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    // This migration removes stale user-facing work for deleted projects.
    // Restoring those assignments or notifications would recreate invalid work.
  }
}
