/**
 * Route: /fest/allgemein – Name, Festdatum, Kopien, Steuerbefreiung, Dateinamensmuster,
 * Fest kopieren (auch über die Menüaktion `festival.copy`), archivieren und wiederherstellen.
 * Zuständig: Bereich „Fest-Einstellungen“.
 */
import { useState } from 'react'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { useMenuAction } from '@/lib/menu-actions'
import { ArchivedFestivalsSection, FestivalActionsSection } from './ArchiveSections'
import { CopyFestivalDialog } from './CopyFestivalDialog'
import { FEST_PAGE_CLASS, ScrollToTopOnMount } from './form-kit'
import { GeneralForm } from './GeneralForm'

export default function FestAllgemeinPage() {
  const { festival } = useActiveFestival()
  const [copyOpen, setCopyOpen] = useState(false)

  useMenuAction('festival.copy', () => setCopyOpen(true), festival !== null)

  if (!festival) return null

  return (
    <PageContainer className={`${FEST_PAGE_CLASS} max-w-3xl`}>
      <ScrollToTopOnMount />
      <PageHeader
        title="Allgemein"
        description={
          <>
            Grundeinstellungen für <span className="font-medium text-foreground">„{festival.name}“</span>.
          </>
        }
      />
      <GeneralForm key={festival.id} festival={festival} />
      <FestivalActionsSection festival={festival} onCopy={() => setCopyOpen(true)} />
      <ArchivedFestivalsSection />
      <CopyFestivalDialog open={copyOpen} onOpenChange={setCopyOpen} source={festival} />
    </PageContainer>
  )
}
