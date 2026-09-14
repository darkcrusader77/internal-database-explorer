import { ProfileRepository } from '../../src/core/profileRepository';
import { profile } from '../helpers';
async function main() {
  const repository = new ProfileRepository(process.argv[2]);
  for (let i = 0; i < 15; i++) await repository.save(profile());
}
main().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
