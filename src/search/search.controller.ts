import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { SearchService, SearchResult } from './search.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guards';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedRequest } from 'src/common/interfaces/jwt-payload.interface';

@Controller('search')
@UseGuards(AuthGuard, RolesGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Roles(UserRole.CUSTOMER, UserRole.FREELANCER, UserRole.ADMIN)
  async search(
    @Query('q') query: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ status: string; data: SearchResult[] }> {
    const userId = req.user.sub;
    const role = req.user.role;
    const results = await this.searchService.search(query, userId, role);
    return { status: 'success', data: results };
  }
}
