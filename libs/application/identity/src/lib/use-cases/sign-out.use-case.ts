import { Result } from '@creativo/domain/kernel';
import { AuthGateway, AuthGatewayError } from '../ports/auth-gateway.port';

export class SignOutUseCase {
  constructor(private readonly authGateway: AuthGateway) {}

  async execute(): Promise<Result<void, AuthGatewayError>> {
    return this.authGateway.signOut();
  }
}
