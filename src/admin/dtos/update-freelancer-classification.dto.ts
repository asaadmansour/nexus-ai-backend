import { IsIn } from 'class-validator';
import {
  PROFESSIONAL_ROLES,
  SENIORITY_LEVELS,
  type ProfessionalRole,
  type SeniorityLevel,
} from '../../freelancers/professional-classification';

export class UpdateFreelancerClassificationDto {
  @IsIn(PROFESSIONAL_ROLES)
  professionalRole!: ProfessionalRole;

  @IsIn(SENIORITY_LEVELS)
  seniorityLevel!: SeniorityLevel;
}
