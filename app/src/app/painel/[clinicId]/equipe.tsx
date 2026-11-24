import { Muted, Notice, Screen, Title } from '@/components/ui';
import { useClinic } from '@/features/panel/clinic-context';
import { TeamManager } from '@/features/panel/TeamManager';

export default function ClinicTeamScreen() {
  const { clinic, canManage } = useClinic();
  return (
    <Screen wide safeTop={false}>
      <Title>Equipe e acessos</Title>
      {canManage ? (
        <>
          <Muted>
            Cada pessoa entra com o próprio e-mail e senha e só enxerga os dados de {clinic.name}.
          </Muted>
          <TeamManager clinicId={clinic.id} />
        </>
      ) : (
        <Notice tone="warning">Somente o gerente da clínica pode gerenciar acessos.</Notice>
      )}
    </Screen>
  );
}
