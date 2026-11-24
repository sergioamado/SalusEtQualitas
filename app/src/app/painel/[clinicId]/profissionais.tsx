import { Notice, Screen, Title } from '@/components/ui';
import { useClinic } from '@/features/panel/clinic-context';
import { ProfessionalsManager } from '@/features/panel/ProfessionalsManager';

export default function ClinicProfessionalsScreen() {
  const { clinic, canManage } = useClinic();
  return (
    <Screen wide safeTop={false}>
      <Title>Profissionais e horários</Title>
      {canManage ? (
        <ProfessionalsManager clinicId={clinic.id} />
      ) : (
        <Notice tone="warning">Somente o gerente da clínica pode alterar profissionais e horários.</Notice>
      )}
    </Screen>
  );
}
