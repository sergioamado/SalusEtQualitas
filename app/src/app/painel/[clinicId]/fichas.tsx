import { Muted, Notice, Screen, Title } from '@/components/ui';
import { useClinic } from '@/features/panel/clinic-context';
import { TemplatesManager } from '@/features/records/TemplatesManager';

/** Módulo Pacientes: modelos de ficha (anamnese / evolução) da clínica. */
export default function ClinicTemplatesScreen() {
  const { canManage, modules } = useClinic();
  return (
    <Screen wide safeTop={false}>
      <Title>Modelos de ficha</Title>
      {!modules.includes('pacientes') ? (
        <Notice tone="warning">
          O módulo Pacientes não está contratado para esta clínica. Fale com o suporte para ativar.
        </Notice>
      ) : !canManage ? (
        <Notice tone="warning">Somente o gerente da clínica pode criar e alterar os modelos de ficha.</Notice>
      ) : (
        <>
          <Muted>Monte as perguntas que sua clínica faz. Cada área de atuação pode ter fichas bem diferentes.</Muted>
          <TemplatesManager />
        </>
      )}
    </Screen>
  );
}
