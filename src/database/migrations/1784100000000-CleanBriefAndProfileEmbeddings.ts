import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CleanBriefAndProfileEmbeddings1784100000000 implements MigrationInterface {
  name = 'CleanBriefAndProfileEmbeddings1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);

    await this.createEmbeddingTables(queryRunner);
    await this.copyLegacyFreelancerEmbeddings(queryRunner);
    await this.backupBriefRawConversation(queryRunner);

    await queryRunner.query(
      `DROP INDEX IF EXISTS freelancer_profiles_embedding_idx`,
    );
    await this.dropColumnsIfPresent(queryRunner, 'freelancer_profiles', [
      'embedding',
    ]);
    await this.dropColumnsIfPresent(queryRunner, 'briefs', [
      'raw_conversation',
      'embedding',
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);

    await this.addColumnIfMissing(
      queryRunner,
      'freelancer_profiles',
      new TableColumn({
        name: 'embedding',
        type: 'vector',
        length: '1024',
        isNullable: true,
      }),
    );
    await this.restoreLegacyFreelancerEmbeddings(queryRunner);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS freelancer_profiles_embedding_idx
      ON freelancer_profiles USING hnsw (embedding vector_cosine_ops)
    `);

    await this.addColumnIfMissing(
      queryRunner,
      'briefs',
      new TableColumn({
        name: 'raw_conversation',
        type: 'jsonb',
        isNullable: true,
      }),
    );
    await this.restoreBriefRawConversation(queryRunner);
    await this.addColumnIfMissing(
      queryRunner,
      'briefs',
      new TableColumn({
        name: 'embedding',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.dropTable(
      'freelancer_profile_embeddings',
      true,
      true,
      true,
    );
    await queryRunner.dropTable('brief_embeddings', true, true, true);
  }

  private async createEmbeddingTables(queryRunner: QueryRunner): Promise<void> {
    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'brief_embeddings',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'brief_id', type: 'uuid' }),
          new TableColumn({
            name: 'embedding_model',
            type: 'varchar',
            length: '100',
          }),
          new TableColumn({ name: 'source_text', type: 'text' }),
          new TableColumn({
            name: 'dimensions',
            type: 'int',
            default: 1024,
          }),
          new TableColumn({
            name: 'embedding',
            type: 'vector',
            length: '1024',
          }),
          new TableColumn({
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          }),
          this.createdAtColumn(),
          this.updatedAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'brief_embeddings',
      new TableForeignKey({
        name: 'brief_embeddings_brief_id_fk',
        columnNames: ['brief_id'],
        referencedTableName: 'briefs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'brief_embeddings',
      new TableIndex({
        name: 'brief_embeddings_brief_id_idx',
        columnNames: ['brief_id'],
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'brief_embeddings',
      new TableIndex({
        name: 'brief_embeddings_brief_id_model_uidx',
        columnNames: ['brief_id', 'embedding_model'],
        isUnique: true,
      }),
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS brief_embeddings_embedding_idx
      ON brief_embeddings USING hnsw (embedding vector_cosine_ops)
    `);

    await this.createTableIfMissing(
      queryRunner,
      new Table({
        name: 'freelancer_profile_embeddings',
        columns: [
          this.uuidPrimaryColumn(),
          new TableColumn({ name: 'freelancer_profile_id', type: 'uuid' }),
          new TableColumn({
            name: 'embedding_model',
            type: 'varchar',
            length: '100',
          }),
          new TableColumn({ name: 'source_text', type: 'text' }),
          new TableColumn({
            name: 'dimensions',
            type: 'int',
            default: 1024,
          }),
          new TableColumn({
            name: 'embedding',
            type: 'vector',
            length: '1024',
          }),
          new TableColumn({
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          }),
          this.createdAtColumn(),
          this.updatedAtColumn(),
        ],
      }),
    );
    await this.addForeignKeyIfMissing(
      queryRunner,
      'freelancer_profile_embeddings',
      new TableForeignKey({
        name: 'freelancer_profile_embeddings_profile_id_fk',
        columnNames: ['freelancer_profile_id'],
        referencedTableName: 'freelancer_profiles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'freelancer_profile_embeddings',
      new TableIndex({
        name: 'freelancer_profile_embeddings_profile_id_idx',
        columnNames: ['freelancer_profile_id'],
      }),
    );
    await this.addIndexIfMissing(
      queryRunner,
      'freelancer_profile_embeddings',
      new TableIndex({
        name: 'freelancer_profile_embeddings_profile_id_model_uidx',
        columnNames: ['freelancer_profile_id', 'embedding_model'],
        isUnique: true,
      }),
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS freelancer_profile_embeddings_embedding_idx
      ON freelancer_profile_embeddings USING hnsw (embedding vector_cosine_ops)
    `);
  }

  private async copyLegacyFreelancerEmbeddings(
    queryRunner: QueryRunner,
  ): Promise<void> {
    if (
      !(await queryRunner.hasTable('freelancer_profiles')) ||
      !(await queryRunner.hasTable('freelancer_profile_embeddings')) ||
      !(await this.hasColumn(queryRunner, 'freelancer_profiles', 'embedding'))
    ) {
      return;
    }

    await queryRunner.query(`
      INSERT INTO freelancer_profile_embeddings (
        freelancer_profile_id,
        embedding_model,
        source_text,
        dimensions,
        embedding,
        metadata
      )
      SELECT
        id,
        'legacy',
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(E'\\n', headline, bio)), ''),
          'legacy freelancer profile embedding'
        ),
        1024,
        embedding,
        jsonb_build_object('source', 'freelancer_profiles.embedding')
      FROM freelancer_profiles
      WHERE embedding IS NOT NULL
      ON CONFLICT (freelancer_profile_id, embedding_model) DO NOTHING
    `);
  }

  private async restoreLegacyFreelancerEmbeddings(
    queryRunner: QueryRunner,
  ): Promise<void> {
    if (
      !(await queryRunner.hasTable('freelancer_profiles')) ||
      !(await queryRunner.hasTable('freelancer_profile_embeddings')) ||
      !(await this.hasColumn(queryRunner, 'freelancer_profiles', 'embedding'))
    ) {
      return;
    }

    await queryRunner.query(`
      UPDATE freelancer_profiles profile
      SET embedding = profile_embedding.embedding
      FROM (
        SELECT DISTINCT ON (freelancer_profile_id)
          freelancer_profile_id,
          embedding
        FROM freelancer_profile_embeddings
        WHERE embedding_model = 'legacy'
        ORDER BY freelancer_profile_id, created_at DESC
      ) profile_embedding
      WHERE profile.id = profile_embedding.freelancer_profile_id
        AND profile.embedding IS NULL
    `);
  }

  private async backupBriefRawConversation(
    queryRunner: QueryRunner,
  ): Promise<void> {
    if (
      !(await queryRunner.hasTable('briefs')) ||
      !(await this.hasColumn(queryRunner, 'briefs', 'raw_conversation'))
    ) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS brief_raw_conversation_backup (
        brief_id uuid PRIMARY KEY,
        raw_conversation jsonb
      )
    `);

    await queryRunner.query(`
      INSERT INTO brief_raw_conversation_backup (brief_id, raw_conversation)
      SELECT id, raw_conversation
      FROM briefs
      WHERE raw_conversation IS NOT NULL
      ON CONFLICT (brief_id) DO UPDATE
      SET raw_conversation = EXCLUDED.raw_conversation
    `);
  }

  private async restoreBriefRawConversation(
    queryRunner: QueryRunner,
  ): Promise<void> {
    if (
      !(await queryRunner.hasTable('briefs')) ||
      !(await queryRunner.hasTable('brief_raw_conversation_backup')) ||
      !(await this.hasColumn(queryRunner, 'briefs', 'raw_conversation'))
    ) {
      return;
    }

    await queryRunner.query(`
      UPDATE briefs brief
      SET raw_conversation = backup.raw_conversation
      FROM brief_raw_conversation_backup backup
      WHERE brief.id = backup.brief_id
        AND brief.raw_conversation IS NULL
    `);

    await queryRunner.query(
      `DROP TABLE IF EXISTS brief_raw_conversation_backup`,
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

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    column: TableColumn,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    if (!table || table.findColumnByName(column.name)) return;

    await queryRunner.addColumn(tableName, column);
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

  private async hasColumn(
    queryRunner: QueryRunner,
    tableName: string,
    columnName: string,
  ): Promise<boolean> {
    const table = await queryRunner.getTable(tableName);
    return Boolean(table?.findColumnByName(columnName));
  }
}
