import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { user_role, vehicle_models } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CompatibilityLink,
  CompatibilityService,
  ModelWithCount,
} from './compatibility.service';
import {
  CreateVehicleModelDto,
  LinkCompatibilityDto,
  UpdateVehicleModelDto,
} from './dto/compatibility.dto';

/** Vehicle models (§12-Б.8). Everyone reads them; the OWNER keeps the list. */
@Controller('vehicle-models')
export class VehicleModelsController {
  constructor(private readonly compatibility: CompatibilityService) {}

  @Get()
  findMany(
    @Query('include_inactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ): Promise<ModelWithCount[]> {
    return this.compatibility.models(includeInactive ?? false);
  }

  @Roles(user_role.OWNER)
  @Post()
  create(
    @Body() dto: CreateVehicleModelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<vehicle_models> {
    return this.compatibility.createModel(dto, user.id);
  }

  @Roles(user_role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleModelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<vehicle_models> {
    return this.compatibility.updateModel(id, dto, user.id);
  }
}

/**
 * Which models a part fits (§12-Б.8).
 *
 * Recording a fit is everyone's — the person at the counter is who finds out
 * — and confirming it is the OWNER's.
 */
@Controller('products/:productId/compatibility')
export class ProductCompatibilityController {
  constructor(private readonly compatibility: CompatibilityService) {}

  @Get()
  findMany(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<CompatibilityLink[]> {
    return this.compatibility.forProduct(productId);
  }

  @Post()
  link(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: LinkCompatibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompatibilityLink> {
    return this.compatibility.link(productId, dto, user.id);
  }

  /** §12-Б.8 — VERIFIED is the shop's word, so it is the OWNER's to give. */
  @Post(':modelId/verify')
  verify(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompatibilityLink> {
    return this.compatibility.setVerified(productId, modelId, true, user);
  }

  @Delete(':modelId/verify')
  unverify(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompatibilityLink> {
    return this.compatibility.setVerified(productId, modelId, false, user);
  }

  @Delete(':modelId')
  async unlink(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('modelId', ParseUUIDPipe) modelId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ removed: true }> {
    await this.compatibility.unlink(productId, modelId, user.id);
    return { removed: true };
  }
}
