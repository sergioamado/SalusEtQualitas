import { Notice, Screen, Title } from '@/components/ui';
import { useClinic } from '@/features/panel/clinic-context';
import { ServicesManager } from '@/features/panel/ServicesManager';

export default function ClinicServicesScreen() {
  const { clinic, canManage } = useClinic();
  return (
    <Screen wide safeTop={false}>
      <Title>Serviços</Title>
      {canManage ? (
        <ServicesManager clinicId={clinic.id} />
      ) : (
        <Notice tone="warning">Somente o gerente da clínica pode cadastrar e alterar serviços.</Notice>
      )}
    </Screen>
  );
}
