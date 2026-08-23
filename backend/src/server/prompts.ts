/*
 * Module: server · MCP prompts — the named workflows an expert can pick
 *
 * Rung 4 of the in-product guidance (docs/design-notes/self-serve-authoring.md).
 * Prompts are USER-controlled by design: the client shows them as a menu, so an
 * expert opening the connector sees named workflows instead of a blank box. This
 * is the mkdocs guide moved inside the product.
 *
 * THE WRITING RULE, measured 2026-08-23 and non-negotiable here:
 *
 *   Prompt text in the USER'S voice is acted on. Text addressed to the
 *   assistant is refused as injection — correctly.
 *
 * A first draft of the probe prompt ended with an imperative aimed at the
 * assistant ("Réponds simplement : …") and was flagged and declined. The same
 * request rewritten as the expert speaking ("Je voudrais préparer une fiche de
 * révision — de quelles informations as-tu besoin ?") was answered normally. So
 * every message below is written as the EXPERT talking: first person, asking for
 * what they want, saying how they want to be talked to. Never a rule about the
 * assistant's behaviour.
 *
 * A second measured constraint: completions do NOT render in this client — the
 * argument is a plain text field. So every argument here is free text a person
 * would actually type (a name, a description), never an id, and the server
 * resolves names through find_node.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

// One user turn — the shape every prompt below returns.
const userTurn = (text: string): GetPromptResult => ({
  messages: [{ role: "user", content: { type: "text", text } }],
});

// How the expert wants to be spoken to. Repeated in each workflow because a
// prompt arrives on its own, with nothing else of ours around it.
const HOW_I_WORK =
  "Parle-moi en français simple : « document », « section », « chapitre », « objectif » — pas de vocabulaire technique ni d'identifiants. " +
  "Je te donnerai des noms, pas des codes ; retrouve les éléments à partir de ce que je te dis. " +
  "Montre-moi ce que tu comptes faire avant de le faire, et ne modifie rien sans mon accord.";

export function registerAuthoringPrompts(server: McpServer) {
  server.registerPrompt(
    "creer-document",
    {
      title: "Créer un nouveau document",
      description:
        "Ouvre la conversation pour créer un document (manuel de l'élève, guide de l'enseignant, fiche de révision…) et le rattacher au programme qu'il doit couvrir.",
      argsSchema: {
        sujet: z.string().describe("Ce que le document doit couvrir, en clair — par exemple « le chapitre 5 de maths CI » ou « la semaine 3 de lecture »"),
      },
    },
    ({ sujet }) =>
      userTurn(
        `Je voudrais créer un nouveau document pour ${sujet}.\n\n` +
        "Avant de commencer, dis-moi ce dont tu as besoin de ma part : quel niveau et quelle matière, quel contenu du programme ce document doit couvrir, pour quel public (élèves ou enseignants), et s'il faut le créer de zéro ou s'il en existe déjà un.\n\n" +
        "Ensuite, propose-moi le plan que tu suivrais, et attends mon accord avant toute modification.\n\n" +
        HOW_I_WORK,
      ),
  );

  server.registerPrompt(
    "appliquer-style",
    {
      title: "Appliquer un style à un document",
      description:
        "Ouvre la conversation pour appliquer une mise en forme du catalogue (style maison, règles de présentation) à un document existant.",
      argsSchema: {
        document: z.string().describe("Le nom du document à mettre en forme — par exemple « Guide de l'enseignant » ou « Manuel de l'élève CI »"),
      },
    },
    ({ document }) =>
      userTurn(
        `Je voudrais appliquer une mise en forme au document « ${document} ».\n\n` +
        "Commence par retrouver ce document et me dire ce qu'il contient déjà comme règles de présentation. " +
        "Montre-moi ensuite les styles disponibles dans le catalogue, avec ce que chacun fait, pour que je choisisse. " +
        "Si plusieurs documents portent ce nom, demande-moi lequel plutôt que de choisir à ma place.\n\n" +
        HOW_I_WORK,
      ),
  );

  server.registerPrompt(
    "creer-routine",
    {
      title: "Créer une routine pédagogique",
      description:
        "Ouvre la conversation pour créer une routine (le déroulé d'une séance, réutilisable d'une leçon à l'autre) et la rattacher aux leçons concernées.",
      argsSchema: {
        intention: z.string().describe("Ce que la routine doit faire faire en classe — par exemple « le déroulé d'une séance de calcul mental »"),
      },
    },
    ({ intention }) =>
      userTurn(
        `Je voudrais créer une routine pédagogique : ${intention}.\n\n` +
        "Regarde d'abord si une routine proche existe déjà dans le catalogue — je préfère partir d'une routine existante et l'adapter plutôt que de tout réécrire. " +
        "Si rien ne convient, demande-moi les étapes que je veux, dans l'ordre, avec leur durée, puis dis-moi à quelles leçons elle s'appliquera.\n\n" +
        "Propose-moi le déroulé complet avant de créer quoi que ce soit.\n\n" +
        HOW_I_WORK,
      ),
  );

  server.registerPrompt(
    "preparer-relecture",
    {
      title: "Préparer une relecture",
      description:
        "Ouvre la conversation pour faire le point sur le brouillon en cours avant de le faire relire ou de le publier.",
      argsSchema: {},
    },
    () =>
      userTurn(
        "Je voudrais faire le point sur mon brouillon avant de le faire relire.\n\n" +
        "Dis-moi ce que j'ai changé depuis la dernière publication, ce qui n'est pas encore branché correctement (un document rattaché à rien, une section orpheline, une routine que personne n'utilise), " +
        "et si ce que j'ai fait couvre bien ce que le programme attend.\n\n" +
        "Fais-moi un résumé que je puisse envoyer à la personne qui relit : ce qui a changé, ce qui reste à faire.\n\n" +
        HOW_I_WORK,
      ),
  );
}
