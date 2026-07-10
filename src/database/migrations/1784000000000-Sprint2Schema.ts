import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableCheck,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class Sprint2Schema1784000000000 implements MigrationInterface {
  name = 'Sprint2Schema1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnsIfMissing(queryRunner, 'projects', [
      new TableColumn({ name: 'description', type: 'text', isNullable: true }),
      new TableColumn({
        name: 'deadline',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'is_deadline_flexible',
        type: 'boolean',
        default: false,
      }),
    ]);

    await this.addColumnsIfMissing(queryRunner, 'freelancer_profiles', [
      new TableColumn({ name: 'headline', type: 'text', isNullable: true }),
      new TableColumn({ name: 'bio', type: 'text', isNullable: true }),
      new TableColumn({
        name: 'skills',
        type: 'text',
        isArray: true,
        isNullable: true,
      }),
      new TableColumn({
        name: 'years_experience',
        type: 'int',
        isNullable: true,
      }),
      new TableColumn({
        name: 'verification_status',
        type: 'varchar',
        length: '40',
        default: "'profile_incomplete'",
      }),
      new TableColumn({
        name: 'assessment_score',
        type: 'numeric',
        precision: 5,
        scale: 2,
        isNullable: true,
      }),
      new TableColumn({
        name: 'assessment_submitted_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'approved_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'rejected_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'rejection_reason',
        type: 'text',
        isNullable: true,
      }),
    ]);
    await this.addCheckIfMissing(
      queryRunner,
      'freelancer_profiles',
      new TableCheck({
        name: 'freelancer_profiles_years_experience_check',
        expression: 'years_experience IS NULL OR years_experience >= 0',
      }),
    );

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'project_status_history',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'project_id', type: 'uuid' }),
          new TableColumn({
            name: 'old_status',
            type: 'varchar',
            length: '40',
            isNullable: true,
          }),
          new TableColumn({
            name: 'new_status',
            type: 'varchar',
            length: '40',
          }),
          new TableColumn({
            name: 'changed_by',
            type: 'uuid',
            isNullable: true,
          }),
          new TableColumn({
            name: 'changed_by_type',
            type: 'varchar',
            length: '30',
            isNullable: true,
          }),
          new TableColumn({ name: 'reason', type: 'text', isNullable: true }),
          this.createdAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_status_history',
      new TableForeignKey({
        name: 'project_status_history_project_id_fk',
        columnNames: ['project_id'],
        referencedTableName: 'projects',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'project_status_history',
      new TableForeignKey({
        name: 'project_status_history_changed_by_fk',
        columnNames: ['changed_by'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'project_status_history',
      new TableIndex({
        name: 'project_status_history_project_id_idx',
        columnNames: ['project_id'],
      }),
    );

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'briefs',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'project_id', type: 'uuid', isUnique: true }),
          new TableColumn({
            name: 'is_complete',
            type: 'boolean',
            default: false,
          }),
          new TableColumn({
            name: 'completed_at',
            type: 'timestamptz',
            isNullable: true,
          }),
          new TableColumn({
            name: 'raw_conversation',
            type: 'jsonb',
            isNullable: true,
          }),
          new TableColumn({
            name: 'client_background',
            type: 'varchar',
            length: '40',
            isNullable: true,
          }),
          new TableColumn({
            name: 'ai_decides_stack',
            type: 'boolean',
            default: false,
          }),
          new TableColumn({ name: 'summary', type: 'text', isNullable: true }),
          new TableColumn({
            name: 'project_type',
            type: 'varchar',
            length: '100',
            isNullable: true,
          }),
          new TableColumn({
            name: 'domain',
            type: 'varchar',
            length: '100',
            isNullable: true,
          }),
          new TableColumn({
            name: 'technical',
            type: 'jsonb',
            isNullable: true,
          }),
          new TableColumn({
            name: 'non_functional',
            type: 'jsonb',
            isNullable: true,
          }),
          new TableColumn({
            name: 'deliverables',
            type: 'jsonb',
            isNullable: true,
          }),
          new TableColumn({
            name: 'suggested_team_size',
            type: 'int',
            isNullable: true,
          }),
          new TableColumn({
            name: 'preferred_timeline',
            type: 'interval',
            isNullable: true,
          }),
          new TableColumn({
            name: 'is_deadline_flexible',
            type: 'boolean',
            default: false,
          }),
          new TableColumn({
            name: 'deadline_date',
            type: 'date',
            isNullable: true,
          }),
          new TableColumn({
            name: 'required_skills',
            type: 'text',
            isNullable: true,
          }),
          new TableColumn({
            name: 'preferred_skills',
            type: 'text',
            isNullable: true,
          }),
          new TableColumn({
            name: 'experience_level',
            type: 'varchar',
            length: '20',
            isNullable: true,
          }),
          new TableColumn({
            name: 'experience_min_years',
            type: 'int',
            isNullable: true,
          }),
          new TableColumn({
            name: 'ai_decided',
            type: 'jsonb',
            isNullable: true,
          }),
          new TableColumn({
            name: 'acceptance_criteria',
            type: 'jsonb',
            isNullable: true,
          }),
          new TableColumn({
            name: 'brief_text',
            type: 'text',
            isNullable: true,
          }),
          new TableColumn({
            name: 'embedding',
            type: 'text',
            isNullable: true,
          }),
          this.createdAtColumn(),
          this.updatedAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'briefs',
      new TableForeignKey({
        name: 'briefs_project_id_fk',
        columnNames: ['project_id'],
        referencedTableName: 'projects',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'briefs',
      new TableIndex({
        name: 'briefs_project_id_uidx',
        columnNames: ['project_id'],
        isUnique: true,
      }),
    );

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'brief_messages',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'brief_id', type: 'uuid' }),
          new TableColumn({
            name: 'sender_type',
            type: 'varchar',
            length: '30',
          }),
          new TableColumn({ name: 'message', type: 'text' }),
          new TableColumn({
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          }),
          this.createdAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'brief_messages',
      new TableForeignKey({
        name: 'brief_messages_brief_id_fk',
        columnNames: ['brief_id'],
        referencedTableName: 'briefs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'brief_messages',
      new TableIndex({
        name: 'brief_messages_brief_id_idx',
        columnNames: ['brief_id'],
      }),
    );

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'agent_jobs',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({
            name: 'agent_name',
            type: 'varchar',
            length: '50',
            isNullable: true,
          }),
          new TableColumn({ name: 'job_type', type: 'varchar', length: '50' }),
          new TableColumn({
            name: 'project_id',
            type: 'uuid',
            isNullable: true,
          }),
          new TableColumn({ name: 'task_id', type: 'uuid', isNullable: true }),
          new TableColumn({ name: 'brief_id', type: 'uuid', isNullable: true }),
          new TableColumn({
            name: 'submission_id',
            type: 'uuid',
            isNullable: true,
          }),
          new TableColumn({
            name: 'matching_run_id',
            type: 'uuid',
            isNullable: true,
          }),
          new TableColumn({
            name: 'status',
            type: 'varchar',
            length: '40',
            default: "'queued'",
          }),
          new TableColumn({
            name: 'queue_name',
            type: 'varchar',
            length: '100',
            isNullable: true,
          }),
          new TableColumn({
            name: 'queue_job_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          }),
          new TableColumn({ name: 'input', type: 'jsonb', isNullable: true }),
          new TableColumn({ name: 'output', type: 'jsonb', isNullable: true }),
          new TableColumn({ name: 'error', type: 'text', isNullable: true }),
          new TableColumn({ name: 'attempts', type: 'int', default: 0 }),
          new TableColumn({ name: 'max_attempts', type: 'int', default: 3 }),
          new TableColumn({
            name: 'locked_at',
            type: 'timestamptz',
            isNullable: true,
          }),
          new TableColumn({
            name: 'started_at',
            type: 'timestamptz',
            isNullable: true,
          }),
          new TableColumn({
            name: 'completed_at',
            type: 'timestamptz',
            isNullable: true,
          }),
          new TableColumn({
            name: 'failed_at',
            type: 'timestamptz',
            isNullable: true,
          }),
          this.createdAtColumn(),
          this.updatedAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs',
      new TableForeignKey({
        name: 'agent_jobs_project_id_fk',
        columnNames: ['project_id'],
        referencedTableName: 'projects',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'agent_jobs',
      new TableForeignKey({
        name: 'agent_jobs_brief_id_fk',
        columnNames: ['brief_id'],
        referencedTableName: 'briefs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'agent_jobs',
      new TableIndex({
        name: 'agent_jobs_status_idx',
        columnNames: ['status'],
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'agent_jobs',
      new TableIndex({
        name: 'agent_jobs_job_type_idx',
        columnNames: ['job_type'],
      }),
    );

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'notifications',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'user_id', type: 'uuid' }),
          new TableColumn({
            name: 'project_id',
            type: 'uuid',
            isNullable: true,
          }),
          new TableColumn({ name: 'task_id', type: 'uuid', isNullable: true }),
          new TableColumn({ name: 'title', type: 'varchar', length: '255' }),
          new TableColumn({ name: 'body', type: 'text', isNullable: true }),
          new TableColumn({ name: 'is_read', type: 'boolean', default: false }),
          this.createdAtColumn(),
          new TableColumn({
            name: 'read_at',
            type: 'timestamptz',
            isNullable: true,
          }),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'notifications',
      new TableForeignKey({
        name: 'notifications_user_id_fk',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'notifications',
      new TableForeignKey({
        name: 'notifications_project_id_fk',
        columnNames: ['project_id'],
        referencedTableName: 'projects',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'notifications',
      new TableIndex({
        name: 'notifications_user_id_idx',
        columnNames: ['user_id'],
      }),
    );

    await this.createFreelancerAssessmentTables(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable(
      'freelancer_assessment_events',
      true,
      true,
      true,
    );
    await queryRunner.dropTable(
      'freelancer_assessment_answers',
      true,
      true,
      true,
    );
    await queryRunner.dropTable(
      'freelancer_assessment_questions',
      true,
      true,
      true,
    );
    await queryRunner.dropTable('freelancer_assessments', true, true, true);
    await queryRunner.dropTable('notifications', true, true, true);
    await queryRunner.dropTable('agent_jobs', true, true, true);
    await queryRunner.dropTable('brief_messages', true, true, true);
    await queryRunner.dropTable('briefs', true, true, true);
    await queryRunner.dropTable('project_status_history', true, true, true);

    await this.dropCheckIfExists(
      queryRunner,
      'freelancer_profiles',
      'freelancer_profiles_years_experience_check',
    );
    await this.dropColumnsIfPresent(queryRunner, 'freelancer_profiles', [
      'headline',
      'bio',
      'skills',
      'years_experience',
      'verification_status',
      'assessment_score',
      'assessment_submitted_at',
      'approved_at',
      'rejected_at',
      'rejection_reason',
    ]);
    await this.dropColumnsIfPresent(queryRunner, 'projects', [
      'description',
      'deadline',
      'is_deadline_flexible',
    ]);
  }

  private async createFreelancerAssessmentTables(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'freelancer_assessments',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'user_id', type: 'uuid' }),
          new TableColumn({ name: 'freelancer_profile_id', type: 'uuid' }),
          new TableColumn({
            name: 'status',
            type: 'varchar',
            length: '40',
            default: "'pending'",
          }),
          new TableColumn({ name: 'duration_seconds', type: 'int' }),
          new TableColumn({
            name: 'started_at',
            type: 'timestamptz',
            isNullable: true,
          }),
          new TableColumn({
            name: 'expires_at',
            type: 'timestamptz',
            isNullable: true,
          }),
          new TableColumn({
            name: 'submitted_at',
            type: 'timestamptz',
            isNullable: true,
          }),
          new TableColumn({
            name: 'score',
            type: 'numeric',
            precision: 5,
            scale: 2,
            isNullable: true,
          }),
          new TableColumn({
            name: 'ai_feedback',
            type: 'jsonb',
            isNullable: true,
          }),
          new TableColumn({
            name: 'generated_from_cv_url',
            type: 'text',
            isNullable: true,
          }),
          this.createdAtColumn(),
          this.updatedAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_assessments',
      new TableForeignKey({
        name: 'freelancer_assessments_user_id_fk',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_assessments',
      new TableForeignKey({
        name: 'freelancer_assessments_profile_id_fk',
        columnNames: ['freelancer_profile_id'],
        referencedTableName: 'freelancer_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'freelancer_assessment_questions',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'assessment_id', type: 'uuid' }),
          new TableColumn({
            name: 'question_type',
            type: 'varchar',
            length: '40',
          }),
          new TableColumn({ name: 'skill', type: 'text', isNullable: true }),
          new TableColumn({
            name: 'difficulty',
            type: 'varchar',
            length: '40',
            isNullable: true,
          }),
          new TableColumn({ name: 'prompt', type: 'text' }),
          new TableColumn({ name: 'choices', type: 'jsonb', isNullable: true }),
          new TableColumn({ name: 'rubric', type: 'jsonb', isNullable: true }),
          new TableColumn({ name: 'order_index', type: 'int' }),
          this.createdAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_assessment_questions',
      new TableForeignKey({
        name: 'freelancer_assessment_questions_assessment_id_fk',
        columnNames: ['assessment_id'],
        referencedTableName: 'freelancer_assessments',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'freelancer_assessment_answers',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'assessment_id', type: 'uuid' }),
          new TableColumn({ name: 'question_id', type: 'uuid' }),
          new TableColumn({ name: 'answer', type: 'jsonb' }),
          new TableColumn({
            name: 'score',
            type: 'numeric',
            precision: 5,
            scale: 2,
            isNullable: true,
          }),
          new TableColumn({ name: 'feedback', type: 'text', isNullable: true }),
          this.createdAtColumn(),
          this.updatedAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_assessment_answers',
      new TableForeignKey({
        name: 'freelancer_assessment_answers_assessment_id_fk',
        columnNames: ['assessment_id'],
        referencedTableName: 'freelancer_assessments',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_assessment_answers',
      new TableForeignKey({
        name: 'freelancer_assessment_answers_question_id_fk',
        columnNames: ['question_id'],
        referencedTableName: 'freelancer_assessment_questions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'freelancer_assessment_events',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'assessment_id', type: 'uuid' }),
          new TableColumn({
            name: 'event_type',
            type: 'varchar',
            length: '50',
          }),
          new TableColumn({
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          }),
          this.createdAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_assessment_events',
      new TableForeignKey({
        name: 'freelancer_assessment_events_assessment_id_fk',
        columnNames: ['assessment_id'],
        referencedTableName: 'freelancer_assessments',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  private uuidPrimaryColumn(): TableColumn {
    return new TableColumn({
      name: 'id',
      type: 'uuid',
      isPrimary: true,
      default: 'gen_random_uuid()',
    });
  }

  private createdAtColumn(): TableColumn {
    return new TableColumn({
      name: 'created_at',
      type: 'timestamptz',
      default: 'now()',
    });
  }

  private updatedAtColumn(): TableColumn {
    return new TableColumn({
      name: 'updated_at',
      type: 'timestamptz',
      default: 'now()',
    });
  }

  private async createTableIfMissing(
    queryRunner: QueryRunner,
    table: Table,
  ): Promise<void> {
    if (!(await queryRunner.hasTable(table.name))) {
      await queryRunner.createTable(table, true);
    }
  }

  private async addColumnsIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    columns: TableColumn[],
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    for (const column of columns) {
      if (!table.findColumnByName(column.name)) {
        await queryRunner.addColumn(tableName, column);
      }
    }
  }

  private async addForeignKeyIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    foreignKey: TableForeignKey,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (
      !table.foreignKeys.some((existing) => existing.name === foreignKey.name)
    ) {
      await queryRunner.createForeignKey(tableName, foreignKey);
    }
  }

  private async addIndexIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    index: TableIndex,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (!table.indices.some((existing) => existing.name === index.name)) {
      await queryRunner.createIndex(tableName, index);
    }
  }

  private async addCheckIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    check: TableCheck,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    if (!table.checks.some((existing) => existing.name === check.name)) {
      await queryRunner.createCheckConstraint(tableName, check);
    }
  }

  private async dropCheckIfExists(
    queryRunner: QueryRunner,
    tableName: string,
    checkName: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const check = table?.checks.find((existing) => existing.name === checkName);
    if (check) {
      await queryRunner.dropCheckConstraint(tableName, check);
    }
  }

  private async dropColumnsIfPresent(
    queryRunner: QueryRunner,
    tableName: string,
    columnNames: string[],
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    for (const columnName of columnNames) {
      if (table.findColumnByName(columnName)) {
        await queryRunner.dropColumn(tableName, columnName);
      }
    }
  }
}
