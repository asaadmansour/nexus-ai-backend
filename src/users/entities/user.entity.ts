import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { FreelancerProfile } from '../../freelancers/entities/freelancer-profile.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';

@Entity('users')
@Index('users_stripe_customer_id_uidx', ['stripeCustomerId'], {
  unique: true,
  where: '"stripe_customer_id" IS NOT NULL',
})
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'citext', unique: true })
  email!: string;

  @Column({
    name: 'phone_number',
    type: 'varchar',
    length: 20,
    unique: true,
    nullable: true,
  })
  phoneNumber!: string | null;

  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified!: boolean;

  @Column({ name: 'is_id_verified', type: 'boolean', default: false })
  isIdVerified!: boolean;

  @Column({
    name: 'hashed_password',
    type: 'text',
    nullable: true,
    select: false,
  })
  hashedPassword!: string | null;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl!: string | null;

  @Column({
    name: 'stripe_customer_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeCustomerId!: string | null;

  @Column({
    name: 'stripe_default_payment_method_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  stripeDefaultPaymentMethodId!: string | null;

  @Column({
    type: 'enum',
    enum: UserRole,
    enumName: 'user_role',
    default: UserRole.CUSTOMER,
  })
  role!: UserRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @OneToOne(() => FreelancerProfile, (profile) => profile.user)
  freelancerProfile?: FreelancerProfile;

  @OneToMany(() => RefreshToken, (refreshtoken) => refreshtoken.user)
  refreshToken?: RefreshToken[];
}
